/**
 * Cheapest way to obtain a set of items ("needs") within a window of days (Compare page), solved
 * exactly as a mixed-integer program (HiGHS, see lp.js):
 *
 *   minimize   Banknotes spent on packages
 *   subject to every needed item: owned + obtained >= needed; every other item: used <= owned + obtained
 *              packages / exchange offers: whole purchases within their limits for the window
 *              tier N+1 of a package ladder only as often as tier N
 *              at most one package of each `exclusive_group` (calendar packs)
 *
 * Everything owned or obtained can be converted for free: containers opened (`contains`), choice
 * chests picked (whole picks), omni items substituted, `reversible` items crafted back up from
 * their contents, `crafted_from` recipes crafted, and coins/diamonds spent in exchange shops
 * (including the VIP shop). Random chests only count with what they GUARANTEE (the smallest amount
 * any drop gives) unless `countRandom` is set; then they count at their expected contents and the
 * result reports the chance of actually getting the needed amount.
 *
 * A second solve keeps the minimum cost and maximizes the worth of what's left over (by-products,
 * via `worthOf`), so equally cheap plans prefer valuable extras.
 *
 * Pure module: callers pass an initialized HiGHS instance.
 */
import { expandPackageFamilies, capacityInWindow, packageCapacityForDays, deliveryPeriod } from './catalog.js';
import { createModel, addTerm, solveModel, varName } from './lp.js';

const EPS = 1e-7;
// Tiny cost per conversion / exchange so the cheapest plan also prefers the simplest path.
const CONVERSION_COST = 1e-6;
const RANDOM_SAMPLES = 20000;

/** Share of a package's contents delivered within `days` (calendar packs, passes). */
function deliveredShare(pkg, days) {
    const period = deliveryPeriod(pkg);
    return period > 1 ? Math.min(1, days / period) : 1;
}

function substituteTargets(item) {
    return Array.isArray(item.substitutes_for)
        ? item.substitutes_for.map((targetId) => [targetId, 1])
        : Object.entries(item.substitutes_for);
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

/** Deterministic PRNG (mulberry32), so the random-drop chance is the same on every run. */
function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Chance that the opened random chests actually give at least `needed` units of `itemId`
 * (Monte Carlo over their drop tables; only drops containing the item directly are counted).
 */
function randomChance(openings, itemId, needed, items) {
    const relevant = openings
        .map(({ itemId: chestId, count }) => ({ drops: items[chestId].drop_table, count: Math.round(count) }))
        .filter(({ drops, count }) => count > 0 && drops.some((drop) => drop.contains?.[itemId]));
    if (needed <= EPS) {
        return 1;
    }
    if (relevant.length === 0) {
        return 0;
    }
    const random = seededRandom(12345);
    let successes = 0;
    for (let sample = 0; sample < RANDOM_SAMPLES; sample++) {
        let total = 0;
        for (const { drops, count } of relevant) {
            for (let n = 0; n < count; n++) {
                let roll = random();
                for (const drop of drops) {
                    roll -= drop.probability;
                    if (roll <= 0) {
                        total += drop.contains?.[itemId] || 0;
                        break;
                    }
                }
            }
        }
        if (total >= needed - EPS) {
            successes++;
        }
    }
    return successes / RANDOM_SAMPLES;
}

function unreachable(status = null) {
    return {
        reachable: false,
        status,
        totalCost: NaN,
        packages: [],
        offers: [],
        conversions: [],
        leftovers: new Map(),
        gained: new Map(),
        byproductWorth: 0,
        random: [],
        picks: [],
    };
}

/**
 * Solves the cheapest plan for `needs` (Map itemId -> quantity).
 * options:
 * - `days`, `startDay` (weekday index, 0 = Monday; null = no calendar), `activeEventIds` (Set;
 *   null = all), `exceedEventPackLimits`, `includeExclusives`;
 * - `countRandom`: random chests count at their expected contents (else only what they guarantee);
 * - `inventory`: Map itemId -> quantity already owned;
 * - `forced`: Map packageId -> purchases that must be part of the plan (pick-one advisor);
 * - `excluded`: Set of package ids that must not be bought;
 * - `worthOf(itemId)`: Banknote worth of one unit, for the by-product tie-break and the result's
 *   `byproductWorth` (null = skip).
 * Returns `{ reachable, totalCost, packages, offers, conversions, picks, leftovers, gained,
 * byproductWorth, random }`: `picks` = options taken from bought packages' choice pools,
 * `leftovers` = what you hold beyond the needs, `gained` = leftovers minus what you owned before
 * (negative = owned items used up), `random` = per needed item that relies on random drops
 * `{ itemId, needed, chance }`.
 */
function solveNeeds(highs, data, needs, options = {}) {
    const {
        days = 7,
        startDay = null,
        activeEventIds = null,
        exceedEventPackLimits = false,
        includeExclusives = true,
        countRandom = false,
        inventory = new Map(),
        forced = new Map(),
        excluded = new Set(),
        worthOf = null,
    } = options;
    const items = data.items || {};
    const packages = expandPackageFamilies(data.packages || {});
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
    const pickVars = new Map(); // package choice picks: name -> { packageId, pkg, option }
    const groups = new Map(); // exclusive_group -> [{ name, capacity }]
    for (const [id, pkg] of Object.entries(packages)) {
        const capacity = packageCapacityForDays(pkg, days, {
            activeEventIds,
            exceedEventPackLimits,
            includeExclusives,
            startDay,
        });
        const mustBuy = forced.get(id) || 0;
        if (!(capacity > 0) || !(pkg.price > 0) || excluded.has(id)) {
            if (mustBuy > 0) {
                return unreachable('forced-unavailable');
            }
            continue;
        }
        const name = varName('p', id);
        model.objective.set(name, pkg.price);
        model.bounds.set(name, { lower: mustBuy, upper: capacity });
        model.integers.add(name);
        produceAll(pkg.contains, name, deliveredShare(pkg, days));
        if (pkg.choice) {
            const pickNames = pkg.choice.choices.map((option, index) => {
                const pick = varName('pc', id, String(index));
                produceAll(option, pick);
                pickVars.set(pick, { packageId: id, pkg, option });
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
        if (pkg.exclusive_group) {
            if (!groups.has(pkg.exclusive_group)) {
                groups.set(pkg.exclusive_group, []);
            }
            groups.get(pkg.exclusive_group).push({ name, capacity });
        }
        packageVars.set(id, { name, pkg });
    }
    for (const [id, { name, pkg }] of packageVars) {
        if (!pkg.requires) {
            continue;
        }
        const lower = packageVars.get(pkg.requires);
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
        } else {
            model.bounds.set(name, { lower: 0, upper: 0 });
        }
    }
    for (const [groupId, members] of groups) {
        const cap = Math.max(...members.map((m) => m.capacity));
        if (Number.isFinite(cap)) {
            model.rows.push({
                name: varName('grp', groupId),
                terms: new Map(members.map((m) => [m.name, 1])),
                op: '<=',
                rhs: cap,
            });
        }
    }

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
        if (item.type === 'random') {
            const contents = countRandom ? null : guaranteedContents(item);
            if (countRandom || Object.keys(contents).length > 0) {
                const name = varName('open', id);
                produce(id, name, -1);
                if (countRandom) {
                    for (const drop of item.drop_table) {
                        produceAll(drop.contains, name, drop.probability);
                    }
                } else {
                    produceAll(contents, name);
                }
                convert(name, 'open', id, { random: countRandom });
            }
        } else if (item.type === 'choice') {
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

    const rhs = (itemId) => (needs.get(itemId) || 0) - (inventory.get(itemId) || 0);
    for (const [itemId, quantity] of needs) {
        if (quantity > (inventory.get(itemId) || 0) && !balances.has(itemId)) {
            return unreachable('no-source');
        }
    }
    for (const [itemId, terms] of balances) {
        model.rows.push({ name: varName('bal', itemId), terms, op: '>=', rhs: rhs(itemId) });
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

    const leftovers = new Map();
    const gained = new Map();
    let byproductWorth = 0;
    const ids = new Set([...balances.keys(), ...inventory.keys(), ...needs.keys()]);
    for (const itemId of ids) {
        let net = 0;
        for (const [name, coefficient] of balances.get(itemId) || []) {
            net += coefficient * value(name);
        }
        const owned = inventory.get(itemId) || 0;
        const need = needs.get(itemId) || 0;
        const left = net + owned - need;
        if (left > 1e-6) {
            leftovers.set(itemId, left);
        }
        // Needed items: only the surplus beyond what was owned counts; others: change vs. owned.
        const change = need > 0 ? Math.max(0, left - Math.max(0, owned - need)) : left - owned;
        if (Math.abs(change) > 1e-6) {
            gained.set(itemId, change);
            byproductWorth += change * (worthOf?.(itemId) ?? 0);
        }
    }

    const random = [];
    if (countRandom) {
        const openings = usedConversions.filter((c) => c.kind === 'open' && c.random);
        for (const [itemId, need] of needs) {
            if (need <= 0) {
                continue;
            }
            let fromRandom = 0;
            for (const { itemId: chestId, count } of openings) {
                for (const drop of items[chestId].drop_table) {
                    fromRandom += count * drop.probability * (drop.contains?.[itemId] || 0);
                }
            }
            if (fromRandom <= EPS) {
                continue;
            }
            const held = (leftovers.get(itemId) || 0) + need;
            const neededFromRandom = Math.max(0, need - (held - fromRandom));
            random.push({ itemId, needed: need, chance: randomChance(openings, itemId, neededFromRandom, items) });
        }
    }

    return {
        reachable: true,
        totalCost: boughtPackages.reduce((sum, p) => sum + p.spend, 0),
        packages: boughtPackages,
        offers: boughtOffers,
        conversions: usedConversions,
        leftovers,
        gained,
        byproductWorth,
        random,
        picks: [...pickVars]
            .filter(([name]) => value(name) > EPS)
            .map(([name, p]) => ({ ...p, count: Math.round(value(name)) })),
    };
}

export { solveNeeds };
