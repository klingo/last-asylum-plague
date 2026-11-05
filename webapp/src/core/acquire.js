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
 * `crafted_from` recipes crafted, and coins/diamonds spent in exchange shops (including the VIP shop). A shop's
 * currency that comes for free (`income_per_hour` in the data) is there for the whole window, as in the weekly plan.
 * Random chests only count with what they GUARANTEE (the smallest amount any drop gives).
 *
 * A second solve keeps the minimum cost and maximizes the worth of what's left over (by-products,
 * via `worthOf`), so equally cheap plans prefer valuable extras.
 *
 * Pure module: callers pass an initialized HiGHS instance and the normalized data (pack-data.js).
 */
import { capacityInWindow, deliveryPeriod, isEventActive, isOnSale, packageCapacityForDays } from './catalog.js';
import { isRandomItem, isChoiceItem, selectCount, substituteTargets } from './items.js';
import { addPackageRules } from './package-rows.js';
import { createModel, addTerm, linkRow, solutionValue, solveModel, varName } from './lp.js';

const EPS = 1e-7;
const HOURS_PER_DAY = 24;
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

/** The model and the balance of every item (itemId -> terms: produced - consumed) the steps below add to. */
function createBuilder() {
    const model = createModel('min');
    const balances = new Map();
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
    return { model, balances, produce, produceAll };
}

/** One integer variable per package on sale (cost in the objective), and a choice package's picks. */
function addPackageVars(builder, packages, { days, startDay, activeEventIds, seasonalPasses, includeExclusives }) {
    const { model, produceAll } = builder;
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
                model.rows.push(linkRow(varName('pcx', id, String(index)), pick, name));
                return pick;
            });
            const terms = new Map(pickNames.map((pick) => [pick, 1]));
            terms.set(name, -selectCount(pkg.choice));
            model.rows.push({ name: varName('pcs', id), terms, op: '<=', rhs: 0 });
        }
        packageVars.set(id, { name, pkg, capacity, coefficient: 1 });
    }
    addPackageRules(model, packageVars, packages);
    return packageVars;
}

/**
 * One integer variable per exchange-shop offer of the shops that are available, and the currency that comes for
 * free within the window (`income_per_hour`). Returns `{ offerVars, freeSupply }` (freeSupply: itemId -> amount).
 */
function addOfferVars(builder, shops, { days, startDay, activeEventIds }) {
    const { model, produce } = builder;
    const offerVars = new Map();
    const freeSupply = new Map();
    for (const [shopId, shop] of Object.entries(shops)) {
        if (shop.event_id && !isEventActive(shop.event_id, activeEventIds)) {
            continue;
        }
        const income = (shop.income_per_hour || 0) * HOURS_PER_DAY * days;
        if (income > 0) {
            freeSupply.set(shop.currency_item_id, (freeSupply.get(shop.currency_item_id) || 0) + income);
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
    return { offerVars, freeSupply };
}

/**
 * The free conversions between items: containers opened, choices picked, reversible items crafted back up,
 * omni items substituted and recipes crafted. Returns Map variable name -> `{ kind, itemId, ... }`.
 */
function addConversions(builder, items) {
    const { model, produce, produceAll } = builder;
    const conversions = new Map();
    const convert = (name, kind, itemId, detail = {}, integer = false) => {
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
    return conversions;
}

/**
 * The second solve: same cost, most valuable leftovers (by `worthOf`). Shop purchases stay limited to what the
 * cheapest plan needed: spending leftover currency on "slightly better than average" offers isn't part of getting the
 * needs. Returns the solution, or null if it isn't optimal.
 */
function solveByproducts(highs, builder, first, { packageVars, offerVars, conversions, worthOf }) {
    const { model, balances } = builder;
    const minCost = [...packageVars.values()].reduce(
        (sum, v) => sum + Math.round(solutionValue(first, v.name)) * v.pkg.price,
        0,
    );
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
    const bounds = new Map(model.bounds);
    for (const name of offerVars.keys()) {
        bounds.set(name, { ...bounds.get(name), upper: Math.round(solutionValue(first, name)) });
    }
    const second = solveModel(highs, {
        ...model,
        sense: 'max',
        objective,
        bounds,
        rows: [...model.rows, { name: 'cost_cap', terms: costTerms, op: '<=', rhs: minCost + 0.5 }],
    });
    return second.status === 'Optimal' ? second : null;
}

/**
 * Worth of what's left beyond the needs (a needed item counts only with its surplus). Free currency covers a
 * shortfall at no cost; unused, it is no leftover of the plan.
 */
function byproductWorthOf(result, balances, needs, freeSupply, worthOf) {
    let total = 0;
    for (const itemId of new Set([...balances.keys(), ...needs.keys()])) {
        let net = 0;
        for (const [name, coefficient] of balances.get(itemId) || []) {
            net += coefficient * solutionValue(result, name);
        }
        if (net < 0) {
            net += Math.min(-net, freeSupply.get(itemId) || 0);
        }
        const need = needs.get(itemId) || 0;
        const left = net - need;
        const change = need > 0 ? Math.max(0, left) : left;
        if (Math.abs(change) > 1e-6) {
            total += change * (worthOf?.(itemId) ?? 0);
        }
    }
    return total;
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
    const builder = createBuilder();
    const { model, balances } = builder;
    const packageVars = addPackageVars(builder, data.packages || {}, {
        days,
        startDay,
        activeEventIds,
        seasonalPasses,
        includeExclusives,
    });
    const { offerVars, freeSupply } = addOfferVars(builder, data.exchange_shops || {}, {
        days,
        startDay,
        activeEventIds,
    });
    const conversions = addConversions(builder, data.items || {});

    for (const [itemId, quantity] of needs) {
        // Nothing makes or takes the item: only a currency that comes for free can still cover the need.
        if (quantity > 0 && !balances.has(itemId) && !((freeSupply.get(itemId) || 0) >= quantity)) {
            return unreachable('no-source');
        }
    }
    for (const [itemId, terms] of balances) {
        // What comes for free counts as supply: the rest has to come from purchases and conversions.
        const rhs = (needs.get(itemId) || 0) - (freeSupply.get(itemId) || 0);
        model.rows.push({ name: varName('bal', itemId), terms, op: '>=', rhs });
    }

    let result = solveModel(highs, model);
    if (result.status !== 'Optimal') {
        return unreachable(result.status);
    }
    if (worthOf) {
        result = solveByproducts(highs, builder, result, { packageVars, offerVars, conversions, worthOf }) ?? result;
    }

    const boughtPackages = [...packageVars]
        .filter(([, v]) => solutionValue(result, v.name) > EPS)
        .map(([id, v]) => ({
            id,
            pkg: v.pkg,
            count: Math.round(solutionValue(result, v.name)),
            spend: Math.round(solutionValue(result, v.name)) * v.pkg.price,
            share: deliveredShare(v.pkg, days),
        }));
    const boughtOffers = [...offerVars]
        .filter(([name]) => solutionValue(result, name) > EPS)
        .map(([name, v]) => ({
            ...v,
            count: Math.round(solutionValue(result, name)),
            coins: Math.round(solutionValue(result, name)) * v.offer.currency_cost,
        }));
    const usedConversions = [...conversions]
        .filter(([name]) => solutionValue(result, name) > EPS)
        .map(([name, c]) => ({ ...c, count: solutionValue(result, name) }));

    return {
        reachable: true,
        totalCost: boughtPackages.reduce((sum, p) => sum + p.spend, 0),
        packages: boughtPackages,
        offers: boughtOffers,
        conversions: usedConversions,
        byproductWorth: byproductWorthOf(result, balances, needs, freeSupply, worthOf),
    };
}

export { solveNeeds };
