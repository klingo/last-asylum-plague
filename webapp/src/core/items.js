/**
 * How an item in pack_data.json is built, read the same way by every core module (worth, fit, sources, the
 * cheapest plan). An item's kind is the first that matches:
 * - 'equivalent': `value_equivalent`, worth the listed items (not made of them: they can't be opened);
 * - 'random':     a random chest (`type: 'random'` with a `drop_table`);
 * - 'choice':     a choice chest (`type: 'choice'` with a `choice` pool);
 * - 'contains':   opens into its `contains` (chests, supplies, the reversible gear-material chain);
 * - 'substitute': stands in for other items (`substitutes_for`, omni shards);
 * - 'recipe':     nothing of the above, but a `crafted_from` recipe;
 * - 'leaf':       nothing to derive it from (its worth is fitted from the deal %).
 *
 * Pure module (no DOM/i18n), shared with Node scripts.
 */

function isRandomItem(item) {
    return item?.type === 'random' && Array.isArray(item.drop_table);
}

function isChoiceItem(item) {
    return item?.type === 'choice' && Boolean(item.choice);
}

/**
 * The expected contents of one go at a list of independent `rolls` (drop tables of `{ contains, probability }`,
 * probabilities under 1 in total = nothing otherwise), e.g. a shop's Encounters: `{ itemId: expected qty }`.
 */
function expectedRolls(rolls) {
    const out = {};
    for (const roll of rolls || []) {
        for (const drop of roll) {
            for (const [id, qty] of Object.entries(drop.contains)) {
                out[id] = (out[id] || 0) + qty * drop.probability;
            }
        }
    }
    return out;
}

/** How many options of a choice pool (`{ choices, select_count }`) are picked: `select_count`, default 1. */
function selectCount(choice) {
    return choice?.select_count || 1;
}

/** `[[targetId, qty], ...]` of an item's `substitutes_for` (a plain list means 1 each). */
function substituteTargets(item) {
    return Array.isArray(item.substitutes_for)
        ? item.substitutes_for.map((targetId) => [targetId, 1])
        : Object.entries(item.substitutes_for || {});
}

/** The item's kind (see above); null for a missing item. */
function itemKind(item) {
    if (!item) {
        return null;
    }
    if (item.value_equivalent) {
        return 'equivalent';
    }
    if (isRandomItem(item)) {
        return 'random';
    }
    if (isChoiceItem(item)) {
        return 'choice';
    }
    if (item.contains) {
        return 'contains';
    }
    if (item.substitutes_for) {
        return 'substitute';
    }
    return item.crafted_from ? 'recipe' : 'leaf';
}

export { isRandomItem, expectedRolls, isChoiceItem, selectCount, substituteTargets, itemKind };
