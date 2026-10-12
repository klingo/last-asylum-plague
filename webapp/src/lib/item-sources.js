/**
 * How many units of one item a purchase gives, nested at any depth (Item Sources page):
 * - contents count in full (a Tempered Steel breaks down into 4 Refined Iron, ... = 256 Cloth);
 * - a pick-one chest counts as picking this item (its best `select_count` options);
 * - a random chest counts at its expected amount (flagged `random`);
 * - a generic item counts where it can be used (1 generic Speedup = 1 Construction Speedup).
 * Recipes (`crafted_from`) and `value_equivalent` aren't contents, so they don't count.
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
 * Base item -> top item of every reversible crafting chain (4 Cloth ⇄ 1 Leather ⇄ ... ⇄ 1 Tempered
 * Steel). The base carries the chain's value (a priority on it spreads up the chain), but pages list
 * the chain under its top item, the one players think in (Tempered Steel rather than Cloth).
 */
function reversibleChainTops(items) {
    const parentOf = new Map();
    for (const [id, item] of Object.entries(items)) {
        const entries = Object.entries(item.contains || {});
        if (item.reversible && entries.length === 1) {
            parentOf.set(entries[0][0], id);
        }
    }
    const tops = new Map();
    for (const childId of parentOf.keys()) {
        if (items[childId]?.reversible) {
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

export { createUnitCounter, isContainerItem, reversibleChainTops };
