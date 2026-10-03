/**
 * Accurate worth model: the best weekly purchases for a Banknote budget, solved as a
 * mixed-integer linear program (HiGHS, see lp.js).
 *
 *   maximize   total points received this week
 *   subject to Banknotes spent <= budget
 *              every package / exchange offer within its weekly limit (catalog.js)
 *              tier N+1 of a package ladder only as often as tier N
 *              coins/diamonds spent <= coins/diamonds received (per currency)
 *              a shop bonus tier only once its spend threshold is reached
 *
 * Items are worth their points (item-values.js); currencies (diamonds, event coins) have no
 * points of their own — they are only worth what the offers they buy are worth, capped by those
 * offers' weekly limits, so leftover currency is worth 0.
 *
 * Two solves: the integer program gives the actual weekly shopping list (whole purchases);
 * its continuous relaxation (bonus tiers fixed to the integer result) gives the marginal rates:
 * - lambda = points the last Banknote of the budget buys;
 * - mu[c]  = points one more unit of currency c would buy.
 * Accurate worth of an item = points / lambda Banknotes; of a currency = mu / lambda.
 *
 * Pure module: callers pass an initialized HiGHS instance.
 */
import { resolveItemValues, bundleValue } from './item-values.js';
import { fitItemPoints } from './point-fit.js';
import {
    expandPackageFamilies,
    currencyItemIds,
    packageWeeklyCapacity,
    offerWeeklyCapacity,
    isUnavailablePass,
} from './catalog.js';
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
        } else if (source === 'random') {
            for (const drop of item.drop_table) {
                currencyFlows(drop.contains, items, values, currencyIds, out, amount * drop.probability, depth + 1);
            }
        }
    }
    return out;
}

/**
 * Solves the weekly plan.
 * options: `budget` (Banknotes/week), `activeEventIds` (Set; events running this week),
 * `includePasses`, `includeExclusives`, `ignored` (Set of item ids forced to 0 points),
 * `weights` (personal item weights), `basePoints` (point-fit.js; fitted here if not given),
 * `activeTrackIds` (Set of spend reward tracks running this week), `unavailablePasses` (Set of pass
 * family ids not on sale).
 */
function solveWeeklyPlan(highs, data, options = {}) {
    const {
        budget = 0,
        activeEventIds = new Set(),
        includePasses = true,
        includeExclusives = false,
        ignored = null,
        weights = null,
        basePoints = fitItemPoints(data).points,
        activeTrackIds = new Set(),
        unavailablePasses = new Set(),
    } = options;
    const items = data.items || {};
    const packages = expandPackageFamilies(data.packages || {});
    const shops = data.exchange_shops || {};
    const currencyIds = currencyItemIds(shops);
    // Currencies carry no points of their own here: their value comes only through the balance rows.
    const zeroCurrencies = Object.fromEntries([...currencyIds].map((id) => [id, 0]));
    const values = resolveItemValues(items, {
        basePoints,
        currencyIds,
        currencyValues: zeroCurrencies,
        ignored,
        weights,
    });
    const availability = { activeEventIds, includePasses, includeExclusives };

    const model = createModel('max');
    const budgetRow = { name: 'budget', terms: new Map(), op: '<=', rhs: budget };
    const balanceRows = new Map(); // currency -> row (spent - received <= 0)
    const balance = (currencyId) => {
        if (!balanceRows.has(currencyId)) {
            balanceRows.set(currencyId, { name: varName('bal', currencyId), terms: new Map(), op: '<=', rhs: 0 });
        }
        return balanceRows.get(currencyId).terms;
    };
    const packageVars = new Map();
    const offerVars = new Map();
    const tierVars = new Map();

    for (const [id, pkg] of Object.entries(packages)) {
        const capacity = packageWeeklyCapacity(pkg, availability);
        // Plain diamond top-ups are the worst deal in the game (diamonds only feed the VIP shop);
        // left out so leftover budget isn't "filled" with them.
        if (
            !(capacity > 0) ||
            !(pkg.price > 0) ||
            pkg.category === 'diamond' ||
            isUnavailablePass(id, pkg, unavailablePasses)
        ) {
            continue;
        }
        if (pkg.requires && !packageVars.has(pkg.requires) && packages[pkg.requires]) {
            // Lower tier unavailable (or listed later): only allowed if it is itself a variable.
            const lower = packages[pkg.requires];
            if (!(packageWeeklyCapacity(lower, availability) > 0)) {
                continue;
            }
        }
        const name = varName('p', id);
        const points = bundleValue(pkg, values);
        const flows = currencyFlows(pkg.contains, items, values, currencyIds);
        // A fractional weekly share (monthly pass: 7/30) is still an all-or-nothing decision: the
        // variable is 0/1 and stands for `scale` purchases.
        const scale = Number.isFinite(capacity) && !Number.isInteger(capacity) ? capacity : 1;
        addTerm(model.objective, name, points.value * scale);
        addTerm(budgetRow.terms, name, pkg.price * scale);
        for (const [currencyId, qty] of flows) {
            addTerm(balance(currencyId), name, -qty * scale);
        }
        model.bounds.set(name, { upper: capacity / scale });
        packageVars.set(id, { name, pkg, points, flows, capacity, scale });
    }
    // Mutually exclusive packages (calendar packs): only one of each group.
    const groups = new Map();
    for (const { name, pkg, capacity, scale } of packageVars.values()) {
        if (pkg.exclusive_group) {
            if (!groups.has(pkg.exclusive_group)) {
                groups.set(pkg.exclusive_group, { terms: new Map(), cap: 0 });
            }
            const group = groups.get(pkg.exclusive_group);
            group.terms.set(name, scale);
            group.cap = Math.max(group.cap, capacity);
        }
    }
    for (const [groupId, group] of groups) {
        if (Number.isFinite(group.cap)) {
            model.rows.push({ name: varName('grp', groupId), terms: group.terms, op: '<=', rhs: group.cap });
        }
    }
    for (const [id, { name, pkg }] of packageVars) {
        const lower = pkg.requires && packageVars.get(pkg.requires);
        if (lower) {
            model.rows.push({
                name: varName('req', id),
                terms: new Map([
                    [name, 1],
                    [lower.name, -1],
                ]),
                op: '<=',
                rhs: 0,
            });
        }
    }

    for (const [shopId, shop] of Object.entries(shops)) {
        if (shop.event_id && !activeEventIds.has(shop.event_id)) {
            continue;
        }
        const shopSpend = new Map();
        for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
            const capacity = offerWeeklyCapacity(offer, shop, availability);
            const unit = values.get(offer.item_id)?.value;
            if (!(capacity > 0) || !(unit > 0)) {
                continue;
            }
            const name = varName('o', shopId, offerKey);
            addTerm(model.objective, name, unit * offer.quantity);
            addTerm(balance(shop.currency_item_id), name, offer.currency_cost);
            addTerm(shopSpend, name, offer.currency_cost);
            model.bounds.set(name, { upper: capacity });
            offerVars.set(name, { shopId, offerKey, offer, points: unit * offer.quantity });
        }
        for (const [threshold, reward] of Object.entries(shop.bonus_tiers || {})) {
            if (shopSpend.size === 0) {
                break;
            }
            const name = varName('b', shopId, threshold);
            const points = bundleValue({ contains: reward }, values);
            addTerm(model.objective, name, points.value);
            for (const [currencyId, qty] of currencyFlows(reward, items, values, currencyIds)) {
                addTerm(balance(currencyId), name, -qty);
            }
            const terms = new Map(shopSpend);
            for (const key of terms.keys()) {
                terms.set(key, -terms.get(key));
            }
            terms.set(name, Number(threshold));
            model.rows.push({ name: varName('bt', shopId, threshold), terms, op: '<=', rhs: 0 });
            model.binaries.add(name);
            tierVars.set(name, { shopId, threshold: Number(threshold), reward, points: points.value });
        }
    }

    // Spend reward tracks running this week: every purchase earns track points (per the track's
    // conversions), and each tier is a binary reached once enough points are earned.
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
            const points = bundleValue({ contains: reward }, values);
            addTerm(model.objective, name, points.value);
            for (const [currencyId, qty] of currencyFlows(reward, items, values, currencyIds)) {
                addTerm(balance(currencyId), name, -qty);
            }
            const terms = new Map(earned);
            terms.set(name, Number(threshold));
            model.rows.push({ name: varName('ttr', trackId, threshold), terms, op: '<=', rhs: 0 });
            model.binaries.add(name);
            trackTierVars.set(name, { trackId, threshold: Number(threshold), reward, points: points.value });
        }
    }

    model.rows.push(budgetRow, ...balanceRows.values());

    // 1) Integer plan: whole purchases.
    for (const name of [...packageVars.values()].map((v) => v.name).concat([...offerVars.keys()])) {
        model.integers.add(name);
    }
    const plan = solveModel(highs, model);
    if (plan.status !== 'Optimal') {
        throw new Error(`Weekly plan solve failed: ${plan.status}`);
    }

    // 2) Marginal rates: continuous relaxation with the bonus tiers fixed to the plan's choice.
    const relaxed = { ...model, integers: new Set(), binaries: new Set(), bounds: new Map(model.bounds) };
    for (const name of model.binaries) {
        const reached = Math.round(plan.values.get(name) || 0);
        relaxed.bounds.set(name, { lower: reached, upper: reached });
    }
    const rates = solveModel(highs, relaxed);
    const lambda = Math.abs(rates.duals.get('budget') || 0);
    const mu = new Map();
    for (const [currencyId, row] of balanceRows) {
        mu.set(currencyId, Math.abs(rates.duals.get(row.name) || 0));
    }

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
    const tiersReached = [...tierVars].filter(([name]) => (plan.values.get(name) || 0) > 0.5).map(([, v]) => v);
    const trackTiersReached = [...trackTierVars]
        .filter(([name]) => (plan.values.get(name) || 0) > 0.5)
        .map(([, v]) => v);
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
        currencies.set(currencyId, { received, spent: spentCoins, mu: mu.get(currencyId) });
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
        budget,
        spent,
        totalPoints: plan.objective,
        purchases,
        exchanges,
        tiersReached,
        trackTiersReached,
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
