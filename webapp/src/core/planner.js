/**
 * The worth model: the best weekly purchases for a Banknote budget, solved as a mixed-integer linear
 * program (HiGHS, see lp.js).
 *
 *   maximize   total points received this week
 *   subject to Banknotes spent <= budget
 *              every package / exchange offer within its weekly limit (catalog.js)
 *              the rules between packages (package-rows.js: tier ladders, exclusive groups, bundles)
 *              coins/diamonds spent <= coins/diamonds received (per currency)
 *              a shop bonus tier / offer unlock only once its progress points are reached
 *              a spend reward track tier only once its track points are reached
 *              a mine floor only after the ones below it (pickaxes at the expected digs per floor, mine.js),
 *              and only in a run that reaches the mine's last progress reward, never past it (unused pickaxes
 *              carry over: better saved for the next run than spent on floors without a progress reward)
 *              offers the user locked (`lockedOffers`) bought exactly as often as set, as far as the spend allows
 *              packages the user skipped (`skippedPackages`) and the higher tiers that need them not bought
 *
 * Items are worth their points (item-values.js); currencies (diamonds, event coins, pickaxes) have no
 * points of their own — they are only worth what the offers they buy are worth, capped by those
 * offers' weekly limits, so leftover currency is worth 0. A shop's currency also comes for free where the data
 * says so (`income_per_hour`) or the page says so (`extraCurrency`).
 *
 * The solves, in this order:
 * - with an event's extra Banknotes (`eventBudget`) first a plan without them: what a Banknote buys then is the bar
 *   an extra one has to clear;
 * - with locked offers (`fixLocks`) first a solve that buys them as far as the spend allows, then they are fixed;
 * - the integer program gives the actual weekly shopping list (whole purchases);
 * - its continuous relaxation (bonus tiers fixed to the integer result) gives the marginal rates:
 *   - lambda = points the last Banknote of the budget buys;
 *   - mu[c]  = points one more unit of currency c would buy (at most what its best shop offer with room left
 *              gives, see capCurrencyRates).
 * Worth of an item = points / lambda Banknotes; of a currency = mu / lambda. The result also answers for any
 * bundle or item afterwards (`worth`, `itemPoints`, `bundlePoints`).
 *
 * Pure module: callers pass an initialized HiGHS instance and the normalized data (pack-data.js).
 */
import { resolveItemValues, bundleValue } from './item-values.js';
import { fitItemPoints } from './point-fit.js';
import { currencyItemIds, isEventActive, packageWeeklyCapacity, offerWeeklyCapacity, isOnSale } from './catalog.js';
import { DAYS_PER_WEEK } from './schedule.js';
import { isRandomItem, expectedRolls } from './items.js';
import { addPackageRules } from './package-rows.js';
import { expandSkips } from './skips.js';
import { createModel, addTerm, linkRow, solutionValue, solveModel, varName } from './lp.js';
import { trackPointsForPrice } from './spend-tracks.js';
import { targetFloor, freeCurrency, pickaxeOdds, mineSegments, normalRewardBundle } from './mine.js';

const EPS = 1e-9;
const HOURS_PER_WEEK = DAYS_PER_WEEK * 24;
// Variable of the extra Banknotes for one event the plan uses (see addEventRows).
const EXTRA_USED = 'extra_used';

/**
 * Currency received from a `{itemId: qty}` bundle: direct currency entries plus currency inside
 * items that simply open into it (e.g. Diamond Golden Egg -> 400 diamonds). Map currency -> qty.
 */
function currencyFlows(contents, items, values, currencyIds, out = new Map(), factor = 1, depth = 0) {
    for (const [id, qty] of Object.entries(contents || {})) {
        const amount = qty * factor;
        if (currencyIds.has(id)) {
            out.set(id, (out.get(id) || 0) + amount);
            continue;
        }
        const item = items[id];
        const source = values.get(id)?.source;
        if (!item || depth > 8) {
            continue;
        }
        if (source === 'contains') {
            currencyFlows(item.contains, items, values, currencyIds, out, amount, depth + 1);
        } else if (source === 'random' && isRandomItem(item)) {
            for (const drop of item.drop_table) {
                currencyFlows(drop.contains, items, values, currencyIds, out, amount * drop.probability, depth + 1);
            }
        }
    }
    return out;
}

/**
 * The model being built and what every step needs: the data, the item values (currencies at 0 points),
 * the budget row and the per-currency balance rows (spent - received <= 0).
 */
function createContext(data, options) {
    const items = data.items || {};
    const shops = data.exchange_shops || {};
    const currencyIds = currencyItemIds(data);
    // Currencies carry no points of their own here: their value comes only through the balance rows.
    const zeroCurrencies = Object.fromEntries([...currencyIds].map((id) => [id, 0]));
    const values = resolveItemValues(items, {
        basePoints: options.basePoints,
        currencyIds,
        currencyValues: zeroCurrencies,
        weights: options.weights,
    });
    const extraForEvent = options.eventBudget?.extra > 0 ? options.eventBudget.extra : 0;
    const balanceRows = new Map();
    return {
        data,
        items,
        packages: data.packages || {},
        shops,
        currencyIds,
        values,
        extraForEvent,
        model: createModel('max'),
        budgetRow: { name: 'budget', terms: new Map(), op: '<=', rhs: options.budget },
        balanceRows,
        /** The terms of currency `currencyId`'s balance row (created on first use). */
        balance(currencyId) {
            if (!balanceRows.has(currencyId)) {
                balanceRows.set(currencyId, { name: varName('bal', currencyId), terms: new Map(), op: '<=', rhs: 0 });
            }
            return balanceRows.get(currencyId).terms;
        },
        /** Points of a reward bundle, and its currency into the balance rows of variable `name`. */
        reward(name, contents) {
            const points = bundleValue({ contains: contents }, values);
            addTerm(this.model.objective, name, points.value);
            for (const [currencyId, qty] of currencyFlows(contents, items, values, currencyIds)) {
                addTerm(this.balance(currencyId), name, -qty);
            }
            return points.value;
        },
    };
}

/**
 * One variable per package on sale this week: points in the objective, price in the budget, the currency
 * it gives in the balance rows. Returns Map packageId -> `{ name, pkg, points, flows, capacity, scale,
 * coefficient }`.
 */
function addPackages(
    ctx,
    { activeEventIds, includePasses, includeExclusives, seasonalPasses, eventDaysLeft, skippedPackages },
) {
    const { model, packages, items, values, currencyIds } = ctx;
    const availability = { activeEventIds, includePasses, includeExclusives, eventDaysLeft };
    const packageVars = new Map();
    // Skipped packages, and the higher tiers that need them, are not bought (the rest of the spend fills up).
    const skipped = expandSkips(skippedPackages || [], packages);
    for (const [id, pkg] of Object.entries(packages)) {
        if (skipped.has(id)) {
            continue;
        }
        const capacity = packageWeeklyCapacity(pkg, availability);
        // Plain diamond top-ups are the worst deal in the game (diamonds only feed the VIP shop);
        // left out so leftover budget isn't "filled" with them.
        if (!(capacity > 0) || pkg.category === 'diamond' || !isOnSale(id, pkg, { activeEventIds, seasonalPasses })) {
            continue;
        }
        const name = varName('p', id);
        const points = bundleValue(pkg, values);
        const flows = currencyFlows(pkg.contains, items, values, currencyIds);
        // A fractional weekly share (monthly pass: 7/30, biweekly pass: 7/14) is still an all-or-nothing decision: the
        // variable is 0/1 and stands for `scale` purchases.
        const scale = Number.isFinite(capacity) && !Number.isInteger(capacity) ? capacity : 1;
        addTerm(model.objective, name, points.value * scale);
        addTerm(ctx.budgetRow.terms, name, pkg.price * scale);
        for (const [currencyId, qty] of flows) {
            addTerm(ctx.balance(currencyId), name, -qty * scale);
        }
        model.bounds.set(name, { upper: capacity / scale });
        packageVars.set(id, { name, pkg, points, flows, capacity, scale, coefficient: scale });
    }
    return packageVars;
}

/**
 * The Events page's what-ifs on one event's packages: `eventSpend` (`{ eventId, min, max }` Banknotes spent on
 * them) and `eventBudget` (extra Banknotes only they may use: the total may go up by up to `extra`, but everything
 * else still has to fit the normal budget). An extra Banknote is only spent where it buys at least what a Banknote
 * of the plan without the extra does (`extraBanknoteRate` points), so packs that give next to nothing (a mine's
 * pickaxes when you own plenty) aren't bought just because the extra is there.
 */
function addEventRows(ctx, packageVars, { budget, eventSpend, eventBudget, extraBanknoteRate }) {
    const { model } = ctx;
    const spendOn = (include) => {
        const terms = new Map();
        for (const { name, pkg, scale } of packageVars.values()) {
            if (include(pkg)) {
                terms.set(name, pkg.price * scale);
            }
        }
        return terms;
    };
    if (eventSpend) {
        const terms = spendOn((pkg) => pkg.event_id === eventSpend.eventId);
        if (eventSpend.min != null) {
            model.rows.push({ name: 'event_min', terms, op: '>=', rhs: eventSpend.min });
        }
        if (eventSpend.max != null) {
            model.rows.push({ name: 'event_max', terms: new Map(terms), op: '<=', rhs: eventSpend.max });
        }
    }
    if (ctx.extraForEvent > 0) {
        const terms = spendOn((pkg) => pkg.event_id !== eventBudget.eventId);
        model.rows.push({ name: 'rest_budget', terms, op: '<=', rhs: budget });
        // The extra Banknotes used: they raise the budget, at the cost of what a normal Banknote buys.
        addTerm(ctx.budgetRow.terms, EXTRA_USED, -1);
        addTerm(model.objective, EXTRA_USED, -(extraBanknoteRate || 0));
        model.bounds.set(EXTRA_USED, { upper: ctx.extraForEvent });
    }
}

/**
 * Exchange shops of the running events (and those without event): offers, progress points (bonus tiers,
 * offer unlocks) and point purchases. Returns `{ offerVars, tierVars, pointPurchaseVars, freePointVars, fixedVars }`.
 */
function addShops(ctx, { activeEventIds, lockedOffers, eventDaysLeft }) {
    const { model, shops, values } = ctx;
    const offerVars = new Map();
    const tierVars = new Map();
    const pointPurchaseVars = new Map(); // name -> shopId
    const freePointVars = new Map(); // name -> { shopId, count } of the free point purchases (daily Encounters)
    const fixedVars = new Map(); // offer variable -> { key, wanted } of offers fixed by the user
    for (const [shopId, shop] of Object.entries(shops)) {
        if (shop.event_id && !isEventActive(shop.event_id, activeEventIds)) {
            continue;
        }
        // Progress points this run (bonus tiers, offer unlocks): `points_per_currency` per coin spent
        // here, plus any `point_purchase` (Surprise Encounter: 100 diamonds = 10 points, its reward, the free
        // ones every day and the run's limit).
        const perCoin = shop.points_per_currency ?? 1;
        const offerProgress = []; // [name, points earned per purchase, unlock_points]
        for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
            const capacity = offerWeeklyCapacity(offer, shop, { activeEventIds });
            const value = values.get(offer.item_id)?.value;
            const unit = value > 0 ? value : 0;
            // A fixed offer is bought exactly that often (0 = never), even if its item is worth nothing to
            // the plan.
            const lockKey = `${shopId}:${offerKey}`;
            const fixed = lockedOffers && lockKey in lockedOffers ? Math.min(lockedOffers[lockKey], capacity) : null;
            if (!(capacity > 0) || fixed === 0 || (!(unit > 0) && fixed === null)) {
                continue;
            }
            const name = varName('o', shopId, offerKey);
            addTerm(model.objective, name, unit * offer.quantity);
            addTerm(ctx.balance(shop.currency_item_id), name, offer.currency_cost);
            offerProgress.push([name, perCoin * offer.currency_cost, offer.unlock_points || 0]);
            model.bounds.set(name, { upper: fixed !== null ? fixed : capacity });
            if (fixed > 0) {
                fixedVars.set(name, { key: lockKey, wanted: fixed });
            }
            offerVars.set(name, { shopId, offerKey, offer, points: unit * offer.quantity });
        }
        if (offerProgress.length === 0) {
            continue;
        }
        const extraProgress = new Map();
        if (shop.point_purchase) {
            const { currency_item_id: currencyId, currency_cost: cost, points, rolls } = shop.point_purchase;
            const contains = expectedRolls(rolls); // what one Encounter gives on average
            // The run's limit covers the free ones too, which are always taken: the paid ones fill the rest.
            const limit = offerWeeklyCapacity(shop.point_purchase, shop, { activeEventIds });
            const days = eventDaysLeft?.[shop.event_id] ?? DAYS_PER_WEEK;
            const free = Math.min((shop.point_purchase.free_per_day || 0) * days, limit);
            const name = varName('pp', shopId);
            addTerm(ctx.balance(currencyId), name, cost);
            addTerm(extraProgress, name, points);
            model.bounds.set(name, { upper: limit - free });
            pointPurchaseVars.set(name, shopId);
            ctx.reward(name, contains);
            if (free > 0) {
                const freeName = varName('ppf', shopId);
                addTerm(extraProgress, freeName, points);
                model.bounds.set(freeName, { lower: free, upper: free });
                freePointVars.set(freeName, { shopId, count: free });
                ctx.reward(freeName, contains);
            }
        }
        // Row "threshold · binary <= progress points" for a bonus tier / unlock; `counts` picks the
        // offers whose spend counts towards it.
        const progressRow = (rowName, binaryName, threshold, counts) => {
            const terms = new Map();
            for (const [name, points, unlockPoints] of offerProgress) {
                if (counts(unlockPoints)) {
                    addTerm(terms, name, -points);
                }
            }
            for (const [name, points] of extraProgress) {
                addTerm(terms, name, -points);
            }
            terms.set(binaryName, threshold);
            model.rows.push({ name: rowName, terms, op: '<=', rhs: 0 });
            model.binaries.add(binaryName);
        };
        for (const [threshold, reward] of Object.entries(shop.bonus_tiers || {})) {
            const name = varName('b', shopId, threshold);
            const points = ctx.reward(name, reward);
            progressRow(varName('bt', shopId, threshold), name, Number(threshold), () => true);
            tierVars.set(name, { shopId, threshold: Number(threshold), reward, points });
        }
        // Offer unlocks: an offer needs `unlock_points` earned on the offers below it (it can't unlock
        // itself), then it's open up to its limit.
        for (const threshold of new Set(offerProgress.map(([, , unlockPoints]) => unlockPoints))) {
            if (!(threshold > 0)) {
                continue;
            }
            const unlock = varName('u', shopId, String(threshold));
            progressRow(varName('ut', shopId, String(threshold)), unlock, threshold, (points) => points < threshold);
            for (const [name, , unlockPoints] of offerProgress) {
                if (unlockPoints === threshold) {
                    model.rows.push(linkRow(varName('ul', name), name, unlock, 1, model.bounds.get(name).upper));
                }
            }
        }
    }
    return { offerVars, tierVars, pointPurchaseVars, freePointVars, fixedVars };
}

/**
 * Spend reward tracks running this week: every purchase earns track points (per the track's conversions),
 * and each tier is a binary reached once enough points are earned. Returns Map name -> tier.
 */
function addTracks(ctx, packageVars, { activeTrackIds }) {
    const { model, data } = ctx;
    const trackTierVars = new Map();
    for (const trackId of activeTrackIds) {
        const track = data.spend_reward_tracks?.[trackId];
        if (!track) {
            continue;
        }
        const earned = new Map();
        for (const { name, pkg, scale } of packageVars.values()) {
            addTerm(earned, name, -trackPointsForPrice(track, pkg.price) * scale);
        }
        for (const [threshold, reward] of Object.entries(track.tiers || {})) {
            const name = varName('tt', trackId, threshold);
            const points = ctx.reward(name, reward);
            const terms = new Map(earned);
            terms.set(name, Number(threshold));
            model.rows.push({ name: varName('ttr', trackId, threshold), terms, op: '<=', rhs: 0 });
            model.binaries.add(name);
            trackTierVars.set(name, { trackId, threshold: Number(threshold), reward, points });
        }
    }
    return trackTierVars;
}

/**
 * Mines (dig events) running this week: their currency (pickaxes) clears floors in order, at the expected
 * digs per floor (mine.js), from the floor reached so far. Per segment between progress-reward floors: floors
 * cleared (integer), and a binary "segment cleared" that pays the progress reward and opens the next segment.
 * A binary "dig" allows any floor only together with the last progress reward, and no floor goes past it (unused
 * pickaxes carry over, so a run that falls short is better not started, and the floors above the last progress
 * reward are better left for the pickaxes of the next run). Every cleared floor gives its expected normal loot and one
 * wish reward (the plan picks the option). The free pickaxes and the ones owned go into the balance row.
 * Returns Map mineId -> `{ mine, startFloor, target, free, owned, dig, segments: [{ ...segment, name, done }],
 * wishVars: [name] }`.
 */
function addMines(ctx, options) {
    const mineVars = new Map();
    for (const [mineId, mine] of Object.entries(ctx.data.mines || {})) {
        if (isEventActive(mine.event_id, options.activeEventIds)) {
            mineVars.set(mineId, addMine(ctx, mineId, mine, options));
        }
    }
    return mineVars;
}

/** The rows between a mine's segments: cleared only with all floors, the next only once this one is cleared. */
function addSegmentRows(ctx, mineId, segments) {
    const { model } = ctx;
    segments.forEach((segment, index) => {
        const next = segments[index + 1];
        if (!segment.reward && !next) {
            return;
        }
        model.binaries.add(segment.done);
        model.rows.push(linkRow(varName('mcf', mineId, String(index)), segment.done, segment.name, segment.floors));
        if (next) {
            model.rows.push(linkRow(varName('mcn', mineId, String(index)), next.name, segment.done, 1, next.floors));
        }
        if (segment.reward) {
            ctx.reward(segment.done, segment.reward);
        }
    });
}

/** The rows of a mine's "dig" variable: any floor only with "dig", and "dig" only with the target floor cleared. */
function addDigRows(ctx, mineId, dig, segments, target) {
    const { model } = ctx;
    model.binaries.add(dig);
    model.rows.push(linkRow(varName('mds', mineId), segments[0].name, dig, 1, segments[0].floors));
    const targetSegment = segments.find((segment) => segment.to === target);
    model.rows.push(linkRow(varName('mdt', mineId), dig, targetSegment.done));
}

/** One running mine's variables and rows; returns its entry of the `addMines` map. */
function addMine(ctx, mineId, mine, { budget, mineProgress, eventDaysLeft, mineSafety }) {
    const { model } = ctx;
    const progress = mineProgress?.[mineId] || {};
    const startFloor = Math.min(Math.max(0, progress.floor || 0), mine.floors);
    const owned = Math.max(0, progress.owned || 0);
    // The purchase bonus needs a pack every day: the weekly spend covers the event's cheapest pack daily.
    const prices = Object.values(ctx.packages)
        .filter((pkg) => pkg.event_id === mine.event_id && pkg.price > 0)
        .map((pkg) => pkg.price);
    const free = freeCurrency(mine, {
        days: eventDaysLeft?.[mine.event_id] ?? DAYS_PER_WEEK,
        withBonus: prices.length > 0 && budget + ctx.extraForEvent >= DAYS_PER_WEEK * Math.min(...prices),
    });
    const balance = ctx.balance(mine.currency_item_id);
    ctx.balanceRows.get(mine.currency_item_id).rhs += free.total + owned;
    const target = targetFloor(mine);
    const dig = target > startFloor ? varName('md', mineId) : null;
    const wishRow = new Map();
    // The safety the user plans with: the pickaxes that suffice in that share of runs, spread over the floors.
    const odds = mineSafety > 0.5 && target > startFloor ? pickaxeOdds(mine, startFloor + 1, target) : null;
    const factor = odds ? (mineSafety >= 1 ? odds.max : odds.atLeast(mineSafety)) / odds.mean : 1;
    const segments = mineSegments(mine, startFloor)
        .filter((segment) => target === 0 || segment.to <= target)
        .map((segment) => ({ ...segment, pickaxes: segment.pickaxes * factor }))
        .map((segment, index) => {
            const name = varName('mf', mineId, String(index));
            addTerm(balance, name, segment.pickaxes / segment.floors);
            ctx.reward(name, normalRewardBundle(mine, segment.normalDigs / segment.floors));
            model.bounds.set(name, { upper: segment.floors });
            model.integers.add(name);
            addTerm(wishRow, name, -1);
            return { ...segment, name, done: varName('mc', mineId, String(index)) };
        });
    addSegmentRows(ctx, mineId, segments);
    if (dig) {
        addDigRows(ctx, mineId, dig, segments, target);
    }
    // One wish reward per cleared floor.
    const wishVars = (mine.wish_rewards || []).map((reward, index) => {
        const name = varName('mw', mineId, String(index));
        ctx.reward(name, reward);
        addTerm(wishRow, name, 1);
        return name;
    });
    model.rows.push({ name: varName('mwr', mineId), terms: wishRow, op: '=', rhs: 0 });
    return { mine, startFloor, target, free, owned, dig, segments, wishVars };
}

/**
 * Offers fixed by the user: first buy as many of them as the spend allows (each counted relative to its
 * wanted amount, so no single one crowds out the others), then fix those counts for the real solve.
 * Returns the shortfalls `[{ key, wanted, got }]`.
 */
function fixLocks(highs, model, fixedVars) {
    const shortfalls = [];
    if (fixedVars.size === 0) {
        return shortfalls;
    }
    const reach = solveModel(highs, {
        ...model,
        objective: new Map([...fixedVars].map(([name, { wanted }]) => [name, 1 / wanted])),
    });
    for (const [name, { key, wanted }] of fixedVars) {
        const got = reach.status === 'Optimal' ? Math.round(solutionValue(reach, name)) : 0;
        model.bounds.set(name, { lower: got, upper: got });
        if (got < wanted) {
            shortfalls.push({ key, wanted, got });
        }
    }
    return shortfalls;
}

/**
 * Marginal rates of the plan: the continuous relaxation with the binaries fixed to the plan's choice.
 * `lambda` = points per extra Banknote (with an event's extra Banknotes, one more general Banknote also
 * relaxes the row of everything else), `mu` = Map currency -> points per extra unit.
 */
function marginalRates(highs, model, plan, balanceRows) {
    const relaxed = { ...model, integers: new Set(), binaries: new Set(), bounds: new Map(model.bounds) };
    for (const name of model.binaries) {
        const reached = Math.round(solutionValue(plan, name));
        relaxed.bounds.set(name, { lower: reached, upper: reached });
    }
    const rates = solveModel(highs, relaxed);
    const lambda = Math.abs(rates.duals.get('budget') || 0) + Math.abs(rates.duals.get('rest_budget') || 0);
    const mu = new Map();
    for (const [currencyId, row] of balanceRows) {
        mu.set(currencyId, Math.abs(rates.duals.get(row.name) || 0));
    }
    return { lambda, mu };
}

/**
 * Caps each shop currency's `mu` at what one more unit buys: the best points per unit among its shop offers that
 * still have room in the plan (below their limit, unlocked). The relaxation keeps the bonus tiers the plan reaches,
 * so their thresholds force the coin purchases and the dual alone would price a coin at what the packs selling it
 * cost (every such pack at exactly ratio 1.0). Currencies without an offer with room keep their dual.
 */
function capCurrencyRates(mu, offerVars, shops, model, plan) {
    const useValue = new Map();
    for (const [name, { shopId, offer, points }] of offerVars) {
        const count = solutionValue(plan, name);
        const unlocked =
            !(offer.unlock_points > 0) || solutionValue(plan, varName('u', shopId, String(offer.unlock_points))) > 0.5;
        if (!unlocked || count >= (model.bounds.get(name)?.upper ?? Infinity) - 1e-6) {
            continue;
        }
        const currencyId = shops[shopId].currency_item_id;
        useValue.set(currencyId, Math.max(useValue.get(currencyId) ?? 0, points / offer.currency_cost));
    }
    for (const [currencyId, value] of useValue) {
        if (mu.has(currencyId)) {
            mu.set(currencyId, Math.min(mu.get(currencyId), value));
        }
    }
}

const DEFAULT_OPTIONS = {
    budget: 0,
    activeEventIds: new Set(),
    includePasses: true,
    includeExclusives: false,
    weights: null,
    activeTrackIds: new Set(),
    seasonalPasses: undefined,
    eventSpend: null,
    extraCurrency: null,
    eventBudget: null,
    lockedOffers: null,
    skippedPackages: null,
    eventDaysLeft: null,
    mineProgress: null,
    mineSafety: 0.5,
};

/** The options with their defaults; like destructuring defaults, an option passed as undefined keeps its default. */
function withDefaults(options) {
    const opts = { ...DEFAULT_OPTIONS };
    for (const [key, value] of Object.entries(options)) {
        if (value !== undefined) {
            opts[key] = value;
        }
    }
    return opts;
}

/**
 * Currency from outside the packs (the page's extra amount, a shop's free income): spent may exceed received by
 * that much.
 */
function addOutsideCurrency(ctx, { extraCurrency }) {
    const outside = Object.entries(extraCurrency || {});
    for (const shop of Object.values(ctx.shops)) {
        outside.push([shop.currency_item_id, (shop.income_per_hour || 0) * HOURS_PER_WEEK]);
    }
    for (const [currencyId, qty] of outside) {
        if (qty > 0) {
            ctx.balance(currencyId);
            ctx.balanceRows.get(currencyId).rhs += qty;
        }
    }
}

/** The package purchases of the plan, `{ purchases: [{ id, pkg, count, spend, points }], spent }`. */
function readPurchases(plan, packageVars) {
    const purchases = [];
    let spent = 0;
    for (const [id, v] of packageVars) {
        const count = Math.round(solutionValue(plan, v.name) * v.scale * 1e6) / 1e6;
        if (count > EPS) {
            spent += count * v.pkg.price;
            purchases.push({ id, pkg: v.pkg, count, spend: count * v.pkg.price, points: count * v.points.value });
        }
    }
    return { purchases, spent };
}

/** The shop offers the plan buys. */
function readExchanges(plan, offerVars) {
    const exchanges = [];
    for (const [name, v] of offerVars) {
        const count = Math.round(solutionValue(plan, name) * 1e6) / 1e6;
        if (count > EPS) {
            exchanges.push({ ...v, count, coins: count * v.offer.currency_cost, totalPoints: count * v.points });
        }
    }
    return exchanges;
}

/** Per currency what the plan receives, spends and has from outside the packs (`extra`), with its marginal `mu`. */
function readCurrencies(plan, balanceRows, mu) {
    const currencies = new Map();
    for (const [currencyId, row] of balanceRows) {
        let received = 0;
        let spentCoins = 0;
        for (const [name, coefficient] of row.terms) {
            const amount = coefficient * solutionValue(plan, name);
            if (amount < 0) {
                received -= amount;
            } else {
                spentCoins += amount;
            }
        }
        currencies.set(currencyId, {
            received,
            // From outside the packs: the page's extra amount, a mine's free and owned pickaxes.
            extra: row.rhs,
            spent: spentCoins,
            mu: mu.get(currencyId),
        });
    }
    return currencies;
}

/** Mines: floors cleared per segment, the wishes picked and the expected loot. */
function readMines(plan, mineVars) {
    return [...mineVars].map(([mineId, { mine, startFloor, target, free, owned, dig, segments, wishVars }]) => {
        const loot = {};
        let floorsCleared = 0;
        let pickaxes = 0;
        const cleared = segments.map((segment) => {
            const floors = Math.round(solutionValue(plan, segment.name));
            floorsCleared += floors;
            pickaxes += (floors * segment.pickaxes) / segment.floors;
            for (const [id, qty] of Object.entries(
                normalRewardBundle(mine, (floors * segment.normalDigs) / segment.floors),
            )) {
                loot[id] = (loot[id] || 0) + qty;
            }
            return { ...segment, cleared: floors, reached: floors === segment.floors && Boolean(segment.reward) };
        });
        const wishes = wishVars.map((name, index) => ({
            index,
            reward: mine.wish_rewards[index],
            count: Math.round(solutionValue(plan, name) * 1e6) / 1e6,
        }));
        return {
            mineId,
            mine,
            startFloor,
            target,
            free,
            owned,
            // Whether the run is dug at all (below the target floor: only if the plan reaches it).
            digs: dig ? solutionValue(plan, dig) > 0.5 : floorsCleared > 0,
            floorsCleared,
            floorReached: startFloor + floorsCleared,
            pickaxes,
            segments: cleared,
            progressReached: cleared.filter((segment) => segment.reached).map((segment) => segment.to),
            wishes,
            normalRewards: loot,
        };
    });
}

/**
 * What the pages ask of a solved plan afterwards: points and Banknote worth of a unit (`itemPoints`, `worth`) and of
 * a bundle (`bundlePoints`), with currencies at their marginal value `mu`; `rate` = points per Banknote.
 */
function createPricing(ctx, mu, rate) {
    const { items, values, currencyIds } = ctx;

    /**
     * Points of one unit, or null: a currency at its marginal value; any other item at its points (currencies at 0)
     * plus the currency it opens into at that currency's marginal value (e.g. a Magic Hat Lucky Box: its expected
     * Magic Hats), as `bundlePoints` counts it inside a pack.
     */
    function itemPoints(itemId) {
        if (mu.has(itemId)) {
            return mu.get(itemId);
        }
        const value = values.get(itemId)?.value;
        if (!Number.isFinite(value)) {
            return null;
        }
        let total = value;
        for (const [currencyId, qty] of currencyFlows({ [itemId]: 1 }, items, values, currencyIds)) {
            total += qty * (mu.get(currencyId) || 0);
        }
        return total;
    }

    return {
        itemPoints,
        /** Banknote worth of one unit (see itemPoints), or null. */
        worth(itemId) {
            const points = itemPoints(itemId);
            return points === null ? null : points / rate;
        },
        /** Marginal points of a bundle, currencies at their marginal value. */
        bundlePoints(bundle) {
            const b = bundleValue(bundle, values);
            let total = b.value;
            for (const [currencyId, qty] of currencyFlows(bundle.contains, items, values, currencyIds)) {
                total += qty * (mu.get(currencyId) || 0);
            }
            return { ...b, value: total };
        },
    };
}

/**
 * Solves the weekly plan (`data`: normalized, see pack-data.js).
 * options: `budget` (Banknotes/week), `activeEventIds` (Set; events running this week),
 * `includePasses`, `includeExclusives`, `weights` (the user's priorities as factors), `basePoints`
 * (point-fit.js; fitted here if not given), `activeTrackIds` (Set of spend reward tracks running this
 * week), `seasonalPasses` (family ids of the seasonal passes on sale; undefined = all), `eventSpend`
 * (`{ eventId, min, max }`: Banknotes spent on that event's packages, for the Events page's what-if steps),
 * `extraCurrency` (`{ currencyId: qty }` obtained outside the packs this week, e.g. diamonds for the VIP
 * Shop; on top of the free income of the shops' currencies, `income_per_hour` in the data), `eventBudget` (`{ eventId, extra }`: up to `extra` Banknotes on top of `budget` that only that event's
 * packages may use, spent only where worth it; see `eventExtraUsed` in the result), `lockedOffers` (`{ "<shopId>:<offerKey>": count }`: shop offers the user fixed to
 * `count` per week, 0 = never; if the spend can't afford them all, as many as possible are bought — see
 * `lockShortfalls` in the result), `eventDaysLeft` (`{ eventId: days }`: days left of the event's run, for its
 * daily pack limits and a mine's free pickaxes; default a whole week), `mineProgress` (`{ mineId: { owned,
 * floor } }`: pickaxes owned and the floor reached this run, Events page), `mineSafety` (the share of runs the
 * pickaxes for the target floor should suffice in: 0.5 = the average (default), 0.9, 0.99, 1 = the worst case),
 * `skippedPackages` (package ids the user skipped, core/skips.js: not bought, nor the higher tiers that need them).
 */
function solveWeeklyPlan(highs, data, options = {}) {
    const opts = withDefaults(options);
    opts.basePoints ??= fitItemPoints(data).points;
    // What a Banknote buys without the event's extra Banknotes: the bar an extra one has to clear.
    if (opts.eventBudget?.extra > 0 && opts.extraBanknoteRate == null) {
        const base = solveWeeklyPlan(highs, data, { ...opts, eventBudget: null });
        opts.extraBanknoteRate = Number.isFinite(base.rate) ? base.rate : 0;
    }
    const ctx = createContext(data, opts);
    const { model, balanceRows } = ctx;

    const packageVars = addPackages(ctx, opts);
    addEventRows(ctx, packageVars, opts);
    addPackageRules(model, packageVars, ctx.packages);
    const { offerVars, tierVars, pointPurchaseVars, freePointVars, fixedVars } = addShops(ctx, opts);
    const trackTierVars = addTracks(ctx, packageVars, opts);
    const mineVars = addMines(ctx, opts);
    addOutsideCurrency(ctx, opts);
    model.rows.push(ctx.budgetRow, ...balanceRows.values());

    // 1) Integer plan: whole purchases.
    for (const name of [...packageVars.values()]
        .map((v) => v.name)
        .concat([...offerVars.keys()], [...pointPurchaseVars.keys()])) {
        model.integers.add(name);
    }
    const lockShortfalls = fixLocks(highs, model, fixedVars);
    const plan = solveModel(highs, model);
    if (plan.status !== 'Optimal') {
        throw new Error(`Weekly plan solve failed: ${plan.status}`);
    }

    // 2) Marginal rates.
    const { lambda, mu } = marginalRates(highs, model, plan, balanceRows);
    capCurrencyRates(mu, offerVars, ctx.shops, model, plan);

    // 3) The plan as the pages read it.
    const { purchases, spent } = readPurchases(plan, packageVars);
    // Progress points outside the shop offers (Surprise Encounters): `count` bought, `free` given.
    const freeOf = (shopId) => [...freePointVars.values()].find((f) => f.shopId === shopId)?.count || 0;
    const pointPurchases = [...pointPurchaseVars]
        .map(([name, shopId]) => ({ shopId, count: Math.round(solutionValue(plan, name)), free: freeOf(shopId) }))
        .filter((p) => p.count > 0 || p.free > 0);
    const reachedOf = (vars) => [...vars].filter(([name]) => solutionValue(plan, name) > 0.5).map(([, tier]) => tier);

    const budgetBinding = lambda > EPS;
    // Budget not binding (everything worthwhile already bought): fall back to the weakest bought pack.
    const packageRatePoints = (v) => v.points.value + [...v.flows].reduce((s, [c, q]) => s + q * (mu.get(c) || 0), 0);
    const boughtRates = purchases
        .map((p) => packageRatePoints(packageVars.get(p.id)) / p.pkg.price)
        .filter((r) => r > EPS);
    const rate = budgetBinding ? lambda : boughtRates.length ? Math.min(...boughtRates) : NaN;

    return {
        values: ctx.values,
        rate,
        lambda,
        budgetBinding,
        mu,
        budget: opts.budget,
        spent,
        totalPoints: plan.objective,
        purchases,
        exchanges: readExchanges(plan, offerVars),
        tiersReached: reachedOf(tierVars),
        pointPurchases,
        trackTiersReached: reachedOf(trackTierVars),
        mines: readMines(plan, mineVars),
        // Of the event's extra Banknotes (`eventBudget`), how many the plan spends.
        eventExtraUsed: ctx.extraForEvent > 0 ? Math.max(0, solutionValue(plan, EXTRA_USED)) : 0,
        lockShortfalls,
        currencies: readCurrencies(plan, balanceRows, mu),
        ...createPricing(ctx, mu, rate),
        /**
         * Whether the package gives the currency of a shop whose bonus tiers the plan reaches: then it can be worth
         * buying for those tiers' rewards even below ratio 1.0 on its own (see capCurrencyRates).
         */
        forBonusTiers(pkg) {
            const tierCurrencies = new Set(reachedOf(tierVars).map((tier) => ctx.shops[tier.shopId].currency_item_id));
            return [...currencyFlows(pkg.contains, ctx.items, ctx.values, ctx.currencyIds).keys()].some((id) =>
                tierCurrencies.has(id),
            );
        },
    };
}

export { solveWeeklyPlan, currencyFlows };
