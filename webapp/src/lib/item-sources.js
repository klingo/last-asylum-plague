/**
 * How many units of one item a purchase gives, nested at any depth (Item Sources page):
 * - contents count in full (a Tempered Steel breaks down into 4 Refined Iron, ... = 256 Cloth);
 * - a pick-one chest counts as picking this item (its best `select_count` options);
 * - a random chest counts at its expected amount (flagged `random`);
 * - a generic item counts where it can be used (1 generic Speedup = 1 Construction Speedup).
 * Recipes (`crafted_from`) and `value_equivalent` aren't contents, so they don't count (a Lv.3 Sharp
 * Beak is worth 9 Lv.1 but can't be turned into them).
 *
 * Pure module (no DOM/i18n), shared with Node scripts.
 */

const NONE = Object.freeze({ units: 0, random: false });

/**
 * An item made of other items (chests, supplies, choice chests, omni shards, the gear-material chain
 * above Cloth): it only stands for what it contains. Item Priorities and Item Sources list just the
 * base items.
 */
function isContainerItem(item) {
    return Boolean(
        item.value_equivalent ||
        (item.type === 'random' && item.drop_table) ||
        (item.type === 'choice' && item.choice) ||
        item.contains ||
        item.substitutes_for,
    );
}

/**
 * `{ lowerId, convertible }` if the item is one level of a chain, else null:
 * - a reversible chain (4 Leather ⇄ 1 Brass): convertible, the levels really turn into each other;
 * - a value level (`value_equivalent` with one entry: a Lv.3 Sharp Beak is worth exactly 9 Lv.1): worth
 *   only, the levels can't be converted.
 */
function chainLink(item) {
    const contains = Object.entries(item?.contains || {});
    if (item?.reversible && contains.length === 1) {
        return { lowerId: contains[0][0], convertible: true };
    }
    const equivalent = Object.entries(item?.value_equivalent || {});
    if (equivalent.length === 1) {
        return { lowerId: equivalent[0][0], convertible: false };
    }
    return null;
}

/** A value level (Lv.3 / Lv.5 Sharp Beak): its own item with its own sources, worth a multiple of the level below. */
function isValueLevel(item) {
    return chainLink(item)?.convertible === false;
}

/**
 * Base item -> top item of every chain (4 Cloth ⇄ 1 Leather ⇄ ... ⇄ 1 Tempered Steel; Lv.1 → Lv.3 → Lv.5
 * Sharp Beak by value). The base carries the chain's value (a priority on it spreads up the chain), but
 * pages list the chain under its top item, the one players think in (Tempered Steel rather than Cloth).
 * `convertibleOnly`: only chains whose levels really turn into each other (Item Sources counts across
 * those levels, but not across value levels).
 */
function itemChainTops(items, { convertibleOnly = false } = {}) {
    const linkOf = (item) => {
        const link = chainLink(item);
        return link && (link.convertible || !convertibleOnly) ? link : null;
    };
    const parentOf = new Map();
    for (const [id, item] of Object.entries(items)) {
        const link = linkOf(item);
        if (link) {
            parentOf.set(link.lowerId, id);
        }
    }
    const tops = new Map();
    for (const childId of parentOf.keys()) {
        if (linkOf(items[childId])) {
            continue; // not the base of its chain
        }
        let top = childId;
        while (parentOf.has(top)) {
            top = parentOf.get(top);
        }
        tops.set(childId, top);
    }
    return tops;
}

function substituteTargets(item) {
    return Array.isArray(item.substitutes_for)
        ? item.substitutes_for.map((targetId) => [targetId, 1])
        : Object.entries(item.substitutes_for);
}

/**
 * Unit counter for `targetId`. Returns `{ ofItem(id), ofBundle({ contains, choice }) }`, each giving
 * `{ units, random }` per one of that item / one purchase of that bundle.
 */
function createUnitCounter(items, targetId) {
    const memo = new Map();

    function ofContents(contents, visiting) {
        let units = 0;
        let random = false;
        for (const [id, qty] of Object.entries(contents || {})) {
            const r = ofItem(id, visiting);
            units += qty * r.units;
            random = random || (r.random && r.units > 0);
        }
        return { units, random };
    }

    function ofChoice(choice, visiting) {
        const options = (choice?.choices || [])
            .map((option) => ofContents(option, visiting))
            .sort((a, b) => b.units - a.units)
            .slice(0, choice?.select_count || 1);
        return {
            units: options.reduce((sum, o) => sum + o.units, 0),
            random: options.some((o) => o.random && o.units > 0),
        };
    }

    function ofItem(id, visiting = new Set()) {
        if (id === targetId) {
            return { units: 1, random: false };
        }
        if (memo.has(id)) {
            return memo.get(id);
        }
        const item = items[id];
        if (!item || visiting.has(id)) {
            return NONE;
        }
        visiting.add(id);
        let result = NONE;
        if (item.type === 'random' && Array.isArray(item.drop_table)) {
            let units = 0;
            for (const drop of item.drop_table) {
                units += drop.probability * ofContents(drop.contains, visiting).units;
            }
            result = { units, random: units > 0 };
        } else if (item.type === 'choice' && item.choice) {
            result = ofChoice(item.choice, visiting);
        } else if (item.contains) {
            result = ofContents(item.contains, visiting);
        } else if (item.substitutes_for) {
            for (const [target, qty] of substituteTargets(item)) {
                const r = ofItem(target, visiting);
                if (qty * r.units > result.units) {
                    result = { units: qty * r.units, random: r.random };
                }
            }
        }
        visiting.delete(id);
        memo.set(id, result);
        return result;
    }

    function ofBundle({ contains, choice } = {}) {
        const fixed = ofContents(contains);
        const picked = choice ? ofChoice(choice, new Set()) : NONE;
        return { units: fixed.units + picked.units, random: fixed.random || picked.random };
    }

    return { ofItem: (id) => ofItem(id), ofBundle };
}

export { createUnitCounter, isContainerItem, isValueLevel, itemChainTops };
