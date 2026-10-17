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
 *
 * Items are worth their points (item-values.js); currencies (diamonds, event coins) have no
 * points of their own — they are only worth what the offers they buy are worth, capped by those
 * offers' weekly limits, so leftover currency is worth 0.
 *
 * Two solves: the integer program gives the actual weekly shopping list (whole purchases);
 * its continuous relaxation (bonus tiers fixed to the integer result) gives the marginal rates:
 * - lambda = points the last Banknote of the budget buys;
 * - mu[c]  = points one more unit of currency c would buy.
 * Worth of an item = points / lambda Banknotes; of a currency = mu / lambda.
 *
 * Pure module: callers pass an initialized HiGHS instance and the normalized data (pack-data.js).
 */
import { resolveItemValues, bundleValue } from './item-values.js';
import { fitItemPoints } from './point-fit.js';
import { currencyItemIds, packageWeeklyCapacity, offerWeeklyCapacity, isOnSale } from './catalog.js';
import { isRandomItem } from './items.js';
import { addPackageRules } from './package-rows.js';
import { createModel, addTerm, solveModel, varName } from './lp.js';
import { trackPointsForPrice } from './spend-tracks.js';

const EPS = 1e-9;

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
    const currencyIds = currencyItemIds(shops);
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
        budgetRow: { name: 'budget', terms: new Map(), op: '<=', rhs: options.budget + extraForEvent },
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
function addPackages(ctx, { activeEventIds, includePasses, includeExclusives, seasonalPasses, exceedEventPackLimits }) {
    const { model, packages, items, values, currencyIds } = ctx;
    const availability = { activeEventIds, includePasses, includeExclusives };
    const packageVars = new Map();
    for (const [id, pkg] of Object.entries(packages)) {
        let capacity = packageWeeklyCapacity(pkg, availability);
        if (capacity > 0 && pkg.event_id && exceedEventPackLimits?.has(pkg.event_id)) {
            capacity = Infinity;
        }
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
 * them) and `eventBudget` (extra Banknotes only they may use: the total may go up by `extra`, but everything else
 * still has to fit the normal budget).
 */
function addEventRows(ctx, packageVars, { budget, eventSpend, eventBudget }) {
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
    }
}

/**
 * Exchange shops of the running events (and those without event): offers, progress points (bonus tiers,
 * offer unlocks) and point purchases. Returns `{ offerVars, tierVars, pointPurchaseVars, fixedVars }`.
 */
function addShops(ctx, { activeEventIds, lockedOffers }) {
    const { model, shops, values } = ctx;
    const offerVars = new Map();
    const tierVars = new Map();
    const pointPurchaseVars = new Map(); // name -> shopId
    const fixedVars = new Map(); // offer variable -> { key, wanted } of offers fixed by the user
    for (const [shopId, shop] of Object.entries(shops)) {
        if (shop.event_id && !activeEventIds.has(shop.event_id)) {
            continue;
        }
        // Progress points this run (bonus tiers, offer unlocks): `points_per_currency` per coin spent
        // here, plus any `point_purchase` (Surprise Encounter: 100 diamonds = 10 points).
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
            const name = varName('pp', shopId);
            addTerm(ctx.balance(shop.point_purchase.currency_item_id), name, shop.point_purchase.currency_cost);
            addTerm(extraProgress, name, shop.point_purchase.points);
            pointPurchaseVars.set(name, shopId);
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
                    model.rows.push({
                        name: varName('ul', name),
                        terms: new Map([
                            [name, 1],
                            [unlock, -model.bounds.get(name).upper],
                        ]),
                        op: '<=',
                        rhs: 0,
                    });
                }
            }
        }
    }
    return { offerVars, tierVars, pointPurchaseVars, fixedVars };
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
        const got = reach.status === 'Optimal' ? Math.round(reach.values.get(name) || 0) : 0;
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
        const reached = Math.round(plan.values.get(name) || 0);
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
 * Solves the weekly plan (`data`: normalized, see pack-data.js).
 * options: `budget` (Banknotes/week), `activeEventIds` (Set; events running this week),
 * `includePasses`, `includeExclusives`, `weights` (the user's priorities as factors), `basePoints`
 * (point-fit.js; fitted here if not given), `activeTrackIds` (Set of spend reward tracks running this
 * week), `seasonalPasses` (family ids of the seasonal passes on sale; undefined = all), `eventSpend`
 * (`{ eventId, min, max }`: Banknotes spent on that event's packages, for the Events page's what-if steps),
 * `exceedEventPackLimits` (Set of event ids whose packages may be bought without their purchase limit),
 * `extraCurrency` (`{ currencyId: qty }` obtained outside the packs this week, e.g. diamonds for the VIP
 * Shop), `eventBudget` (`{ eventId, extra }`: `extra` Banknotes on top of `budget` that only that event's
 * packages may use), `lockedOffers` (`{ "<shopId>:<offerKey>": count }`: shop offers the user fixed to
 * `count` per week, 0 = never; if the spend can't afford them all, as many as possible are bought — see
 * `lockShortfalls` in the result).
 */
function solveWeeklyPlan(highs, data, options = {}) {
    const opts = {
        budget: 0,
        activeEventIds: new Set(),
        includePasses: true,
        includeExclusives: false,
        weights: null,
        activeTrackIds: new Set(),
        seasonalPasses: undefined,
        eventSpend: null,
        exceedEventPackLimits: null,
        extraCurrency: null,
        eventBudget: null,
        lockedOffers: null,
    };
    // Like destructuring defaults: an option passed as undefined keeps its default.
    for (const [key, value] of Object.entries(options)) {
        if (value !== undefined) {
            opts[key] = value;
        }
    }
    opts.basePoints ??= fitItemPoints(data).points;
    const ctx = createContext(data, opts);
    const { model, items, values, currencyIds, balanceRows } = ctx;

    const packageVars = addPackages(ctx, opts);
    addEventRows(ctx, packageVars, opts);
    addPackageRules(model, packageVars, ctx.packages);
    const { offerVars, tierVars, pointPurchaseVars, fixedVars } = addShops(ctx, opts);
    const trackTierVars = addTracks(ctx, packageVars, opts);
    // Currency from outside the packs: spent may exceed received by that much.
    for (const [currencyId, qty] of Object.entries(opts.extraCurrency || {})) {
        if (qty > 0) {
            ctx.balance(currencyId);
            balanceRows.get(currencyId).rhs = qty;
        }
    }
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

    // 3) The plan as the pages read it.
    const purchases = [];
    let spent = 0;
    for (const [id, v] of packageVars) {
        const count = Math.round((plan.values.get(v.name) || 0) * v.scale * 1e6) / 1e6;
        if (count > EPS) {
            spent += count * v.pkg.price;
            purchases.push({ id, pkg: v.pkg, count, spend: count * v.pkg.price, points: count * v.points.value });
        }
    }
    const exchanges = [];
    for (const [name, v] of offerVars) {
        const count = Math.round((plan.values.get(name) || 0) * 1e6) / 1e6;
        if (count > EPS) {
            exchanges.push({ ...v, count, coins: count * v.offer.currency_cost, totalPoints: count * v.points });
        }
    }
    // Progress points bought outside the shop offers (Surprise Encounters).
    const pointPurchases = [...pointPurchaseVars]
        .map(([name, shopId]) => ({ shopId, count: Math.round(plan.values.get(name) || 0) }))
        .filter((p) => p.count > 0);
    const reachedOf = (vars) =>
        [...vars].filter(([name]) => (plan.values.get(name) || 0) > 0.5).map(([, tier]) => tier);
    const currencies = new Map();
    for (const [currencyId, row] of balanceRows) {
        let received = 0;
        let spentCoins = 0;
        for (const [name, coefficient] of row.terms) {
            const amount = coefficient * (plan.values.get(name) || 0);
            if (amount < 0) {
                received -= amount;
            } else {
                spentCoins += amount;
            }
        }
        currencies.set(currencyId, {
            received,
            extra: opts.extraCurrency?.[currencyId] || 0,
            spent: spentCoins,
            mu: mu.get(currencyId),
        });
    }

    const budgetBinding = lambda > EPS;
    // Budget not binding (everything worthwhile already bought): fall back to the weakest bought pack.
    const packageRatePoints = (v) => v.points.value + [...v.flows].reduce((s, [c, q]) => s + q * (mu.get(c) || 0), 0);
    const boughtRates = purchases
        .map((p) => packageRatePoints(packageVars.get(p.id)) / p.pkg.price)
        .filter((r) => r > EPS);
    const rate = budgetBinding ? lambda : boughtRates.length ? Math.min(...boughtRates) : NaN;

    return {
        values,
        rate,
        lambda,
        budgetBinding,
        mu,
        budget: opts.budget,
        spent,
        totalPoints: plan.objective,
        purchases,
        exchanges,
        tiersReached: reachedOf(tierVars),
        pointPurchases,
        trackTiersReached: reachedOf(trackTierVars),
        lockShortfalls,
        currencies,
        /** Banknote worth of one unit (currencies: their marginal value), or null. */
        worth(itemId) {
            if (mu.has(itemId)) {
                return mu.get(itemId) / rate;
            }
            const value = values.get(itemId)?.value;
            return Number.isFinite(value) ? value / rate : null;
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

export { solveWeeklyPlan, currencyFlows };
