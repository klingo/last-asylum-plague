/**
 * Cheapest way to obtain a set of items ("needs") within a window of days (Compare page), solved
 * exactly as a mixed-integer program (HiGHS, see lp.js):
 *
 *   minimize   Banknotes spent on packages
 *   subject to every needed item: obtained >= needed; every other item: used <= obtained
 *              packages / exchange offers: whole purchases within their limits for the window
 *              the rules between packages (package-rows.js: tier ladders, exclusive groups, bundles)
 *
 * Everything obtained can be converted for free: containers opened (`contains`), choice chests picked
 * (whole picks), omni items substituted, `reversible` items crafted back up from their contents,
 * `crafted_from` recipes crafted, and coins/diamonds spent in exchange shops (including the VIP shop).
 * Random chests only count with what they GUARANTEE (the smallest amount any drop gives).
 *
 * A second solve keeps the minimum cost and maximizes the worth of what's left over (by-products,
 * via `worthOf`), so equally cheap plans prefer valuable extras.
 *
 * Pure module: callers pass an initialized HiGHS instance and the normalized data (pack-data.js).
 */
import { capacityInWindow, packageCapacityForDays, deliveryPeriod, isOnSale } from './catalog.js';
import { isRandomItem, isChoiceItem, substituteTargets } from './items.js';
import { addPackageRules } from './package-rows.js';
import { createModel, addTerm, solveModel, varName } from './lp.js';

const EPS = 1e-7;
// Tiny cost per conversion / exchange so the cheapest plan also prefers the simplest path.
const CONVERSION_COST = 1e-6;

/** Share of a package's contents delivered within `days` (calendar packs, passes). */
function deliveredShare(pkg, days) {
    const period = deliveryPeriod(pkg);
    return period > 1 ? Math.min(1, days / period) : 1;
}

/** What a random chest is sure to give: per item, the smallest amount over all its drops. */
function guaranteedContents(item) {
    const drops = item.drop_table || [];
    const result = {};
    const ids = new Set(drops.flatMap((drop) => Object.keys(drop.contains || {})));
    for (const id of ids) {
        const least = Math.min(...drops.map((drop) => drop.contains?.[id] || 0));
        if (least > 0) {
            result[id] = least;
        }
    }
    return result;
}

function unreachable(status = null) {
    return {
        reachable: false,
        status,
        totalCost: NaN,
        packages: [],
        offers: [],
        conversions: [],
        byproductWorth: 0,
    };
}

/**
 * Solves the cheapest plan for `needs` (Map itemId -> quantity).
 * options:
 * - `days`, `startDay` (weekday index, 0 = Monday; null = no calendar), `activeEventIds` (Set;
 *   null = all), `seasonalPasses` (family ids on sale; undefined = all), `includeExclusives`;
 * - `worthOf(itemId)`: Banknote worth of one unit, for the by-product tie-break and the result's
 *   `byproductWorth` (null = skip).
 * Returns `{ reachable, totalCost, packages, offers, conversions, byproductWorth }`: `byproductWorth` =
 * the worth of everything obtained beyond the needs.
 */
function solveNeeds(highs, data, needs, options = {}) {
    const {
        days = 7,
        startDay = null,
        activeEventIds = null,
        seasonalPasses = undefined,
        includeExclusives = true,
        worthOf = null,
    } = options;
    const items = data.items || {};
    const packages = data.packages || {};
    const model = createModel('min');
    const balances = new Map(); // itemId -> terms (produced - consumed)
    const produce = (itemId, name, qty) => {
        if (!balances.has(itemId)) {
            balances.set(itemId, new Map());
        }
        addTerm(balances.get(itemId), name, qty);
    };
    const produceAll = (contents, name, factor = 1) => {
        for (const [id, qty] of Object.entries(contents || {})) {
            produce(id, name, qty * factor);
        }
    };

    const packageVars = new Map();
    for (const [id, pkg] of Object.entries(packages)) {
        const capacity = packageCapacityForDays(pkg, days, { activeEventIds, includeExclusives, startDay });
        if (!(capacity > 0) || !isOnSale(id, pkg, { activeEventIds, seasonalPasses })) {
            continue;
        }
        const name = varName('p', id);
        model.objective.set(name, pkg.price);
        model.bounds.set(name, { upper: capacity });
        model.integers.add(name);
        produceAll(pkg.contains, name, deliveredShare(pkg, days));
        if (pkg.choice) {
            const pickNames = pkg.choice.choices.map((option, index) => {
                const pick = varName('pc', id, String(index));
                produceAll(option, pick);
                model.integers.add(pick);
                model.rows.push({
                    name: varName('pcx', id, String(index)),
                    terms: new Map([
                        [pick, 1],
                        [name, -1],
                    ]),
                    op: '<=',
                    rhs: 0,
                });
                return pick;
            });
            const terms = new Map(pickNames.map((pick) => [pick, 1]));
            terms.set(name, -(pkg.choice.select_count || 1));
            model.rows.push({ name: varName('pcs', id), terms, op: '<=', rhs: 0 });
        }
        packageVars.set(id, { name, pkg, capacity, coefficient: 1 });
    }
    addPackageRules(model, packageVars, packages);

    const offerVars = new Map();
    for (const [shopId, shop] of Object.entries(data.exchange_shops || {})) {
        if (shop.event_id && activeEventIds && !activeEventIds.has(shop.event_id)) {
            continue;
        }
        for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
            const capacity = capacityInWindow(offer.purchase_limit, offer.limit_type, {
                days,
                startDay,
                eventTied: Boolean(shop.event_id),
            });
            if (!(capacity > 0)) {
                continue;
            }
            const name = varName('o', shopId, offerKey);
            model.objective.set(name, CONVERSION_COST);
            model.bounds.set(name, { upper: capacity });
            model.integers.add(name);
            produce(offer.item_id, name, offer.quantity);
            produce(shop.currency_item_id, name, -offer.currency_cost);
            offerVars.set(name, { shopId, shop, offerKey, offer });
        }
    }

    // Free conversions between items.
    const conversions = new Map();
    const convert = (name, kind, itemId, detail, integer = false) => {
        conversions.set(name, { kind, itemId, ...detail });
        model.objective.set(name, CONVERSION_COST);
        if (integer) {
            model.integers.add(name);
        }
    };
    for (const [id, item] of Object.entries(items)) {
        if (isRandomItem(item)) {
            const contents = guaranteedContents(item);
            if (Object.keys(contents).length > 0) {
                const name = varName('open', id);
                produce(id, name, -1);
                produceAll(contents, name);
                convert(name, 'open', id);
            }
        } else if (isChoiceItem(item)) {
            item.choice.choices.forEach((option, index) => {
                const name = varName('pick', id, String(index));
                produce(id, name, -1);
                produceAll(option, name);
                convert(name, 'pick', id, { option }, true);
            });
        } else if (item.contains) {
            const name = varName('open', id);
            produce(id, name, -1);
            produceAll(item.contains, name);
            convert(name, 'open', id);
            if (item.reversible) {
                const craft = varName('craft', id);
                produce(id, craft, 1);
                produceAll(item.contains, craft, -1);
                convert(craft, 'craft', id);
            }
        }
        // An item can also stand in for others and have a recipe, on top of the above.
        if (item.substitutes_for) {
            for (const [targetId, qty] of substituteTargets(item)) {
                const name = varName('sub', id, targetId);
                produce(id, name, -1);
                produce(targetId, name, qty);
                convert(name, 'substitute', id, { targetId });
            }
        }
        if (item.crafted_from) {
            const name = varName('recipe', id);
            produce(id, name, 1);
            produceAll(item.crafted_from, name, -1);
            convert(name, 'craft', id, { ingredients: item.crafted_from }, true);
        }
    }

    for (const [itemId, quantity] of needs) {
        if (quantity > 0 && !balances.has(itemId)) {
            return unreachable('no-source');
        }
    }
    for (const [itemId, terms] of balances) {
        model.rows.push({ name: varName('bal', itemId), terms, op: '>=', rhs: needs.get(itemId) || 0 });
    }

    let result = solveModel(highs, model);
    if (result.status !== 'Optimal') {
        return unreachable(result.status);
    }
    const minCost = [...packageVars.values()].reduce(
        (sum, v) => sum + Math.round(result.values.get(v.name) || 0) * v.pkg.price,
        0,
    );

    // Tie-break: same cost, most valuable leftovers.
    if (worthOf) {
        const objective = new Map();
        for (const [itemId, terms] of balances) {
            const worth = worthOf(itemId);
            if (!Number.isFinite(worth) || worth === 0) {
                continue;
            }
            for (const [name, qty] of terms) {
                addTerm(objective, name, worth * qty);
            }
        }
        for (const name of [...conversions.keys(), ...offerVars.keys()]) {
            addTerm(objective, name, -CONVERSION_COST);
        }
        const costTerms = new Map([...packageVars.values()].map((v) => [v.name, v.pkg.price]));
        // Shop purchases stay limited to what the cheapest plan needed: spending leftover currency
        // on "slightly better than average" offers isn't part of getting the needs.
        const bounds = new Map(model.bounds);
        for (const name of offerVars.keys()) {
            bounds.set(name, { ...bounds.get(name), upper: Math.round(result.values.get(name) || 0) });
        }
        const second = solveModel(highs, {
            ...model,
            sense: 'max',
            objective,
            bounds,
            rows: [...model.rows, { name: 'cost_cap', terms: costTerms, op: '<=', rhs: minCost + 0.5 }],
        });
        if (second.status === 'Optimal') {
            result = second;
        }
    }

    const value = (name) => result.values.get(name) || 0;
    const boughtPackages = [...packageVars]
        .filter(([, v]) => value(v.name) > EPS)
        .map(([id, v]) => ({
            id,
            pkg: v.pkg,
            count: Math.round(value(v.name)),
            spend: Math.round(value(v.name)) * v.pkg.price,
            share: deliveredShare(v.pkg, days),
        }));
    const boughtOffers = [...offerVars]
        .filter(([name]) => value(name) > EPS)
        .map(([name, v]) => ({
            ...v,
            count: Math.round(value(name)),
            coins: Math.round(value(name)) * v.offer.currency_cost,
        }));
    const usedConversions = [...conversions]
        .filter(([name]) => value(name) > EPS)
        .map(([name, c]) => ({ ...c, count: value(name) }));

    // Worth of what's left beyond the needs (a needed item counts only with its surplus).
    let byproductWorth = 0;
    for (const itemId of new Set([...balances.keys(), ...needs.keys()])) {
        let net = 0;
        for (const [name, coefficient] of balances.get(itemId) || []) {
            net += coefficient * value(name);
        }
        const need = needs.get(itemId) || 0;
        const left = net - need;
        const change = need > 0 ? Math.max(0, left) : left;
        if (Math.abs(change) > 1e-6) {
            byproductWorth += change * (worthOf?.(itemId) ?? 0);
        }
    }

    return {
        reachable: true,
        totalCost: boughtPackages.reduce((sum, p) => sum + p.spend, 0),
        packages: boughtPackages,
        offers: boughtOffers,
        conversions: usedConversions,
        byproductWorth,
    };
}

export { solveNeeds };
