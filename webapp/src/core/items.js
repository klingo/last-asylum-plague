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

export { isRandomItem, isChoiceItem, substituteTargets, itemKind };
