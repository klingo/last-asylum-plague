/**
 * Resolves every item's worth in POINTS — the relative value scale shared by both the simple and
 * the accurate model (1 point is roughly what the in-game deal % counts one diamond as).
 *
 * Resolution order per item:
 *   1. ignored by the user          -> 0
 *   2. a currency (diamonds, coins) -> whatever the caller says it's worth (`currencyValues`)
 *   3. base points                  -> the caller's `basePoints` (fitted from deal %, see
 *                                      point-fit.js, or a user override)
 *   4. `value_equivalent`           -> sum of the listed items
 *   5. structure: `contains` = sum, random `drop_table` = expected value, `choice` = best
 *      `select_count` options, `substitutes_for` = best target
 *   6. otherwise unknown (null)
 * A `reversible` item with base points also lends them downward to its single content item
 * (e.g. Tempered Steel = 4 Refined Iron -> Refined Iron = value / 4), so a crafting chain only
 * needs one value.
 *
 * Unknown parts count as 0 and mark the result `incomplete`; a result with no known part at all
 * stays unknown. Pure module (no DOM/i18n), shared with Node scripts.
 */

function isChoiceItem(item) {
    return item?.type === 'choice' && item.choice;
}

function isRandomItem(item) {
    return item?.type === 'random' && Array.isArray(item.drop_table);
}

/**
 * Extends `explicit` (Map itemId -> `{ value, source }`) with the values lent down reversible
 * (crafting) chains, without overwriting existing entries. Returns the same Map.
 */
function lendReversible(items, explicit) {
    let changed = true;
    while (changed) {
        changed = false;
        for (const [id, item] of Object.entries(items)) {
            const entries = Object.entries(item.contains || {});
            if (!item.reversible || entries.length !== 1 || !explicit.has(id)) {
                continue;
            }
            const [childId, qty] = entries[0];
            if (!explicit.has(childId)) {
                explicit.set(childId, {
                    value: explicit.get(id).value / qty,
                    source: 'reversible',
                    parts: [{ id, qty: 1 / qty, value: explicit.get(id).value }],
                });
                changed = true;
            }
        }
    }
    return explicit;
}

/**
 * Sums `{itemId: qty}` against `valueOf`. Returns `{ value, incomplete, parts }`, where `value`
 * is null only if nothing in the bundle has a known value.
 */
function sumContents(contents, valueOf, factor = 1) {
    let total = 0;
    let known = 0;
    let incomplete = false;
    const parts = [];
    for (const [id, qty] of Object.entries(contents || {})) {
        const entry = valueOf(id);
        const unit = entry?.value ?? null;
        parts.push({ id, qty: qty * factor, value: unit });
        if (unit === null) {
            incomplete = true;
            continue;
        }
        known++;
        total += qty * factor * unit;
        incomplete = incomplete || Boolean(entry.incomplete);
    }
    return { value: known > 0 ? total : null, incomplete, parts };
}

/** Best `select_count` options of a choice pool (each option picked at most once). */
function bestChoices(choice, valueOf) {
    const selectCount = choice.select_count || 1;
    const options = (choice.choices || [])
        .map((option, index) => ({ index, ...sumContents(option, valueOf) }))
        .filter((option) => option.value !== null)
        .sort((a, b) => b.value - a.value);
    const picked = options.slice(0, selectCount);
    if (picked.length === 0) {
        return { value: null, incomplete: true, parts: [], picked: [] };
    }
    return {
        value: picked.reduce((sum, option) => sum + option.value, 0),
        incomplete: picked.length < selectCount || picked.some((option) => option.incomplete),
        parts: picked.flatMap((option) => option.parts),
        picked: picked.map((option) => option.index),
    };
}

/**
 * Resolves all items. Returns a Map `itemId -> { value, source, incomplete, parts?, picked? }`
 * (value null = unknown).
 * - `basePoints`: Map `itemId -> { value, source, ... }` of the items valued directly (point-fit.js).
 * - `currencyValues`: `{ itemId: points | null }` for every currency item; a currency missing
 *   from it (or null) is unknown.
 * - `ignored`: Set of item ids forced to 0 for this session.
 * - `weights`: `{ itemId: factor }`, how much an item matters to the user (1 = as valued). Applied
 *   after everything else, so containers pick up their weighted contents and a weight on a
 *   container multiplies on top.
 */
function resolveItemValues(
    items,
    { basePoints = null, currencyValues = {}, currencyIds = null, ignored = null, weights = null } = {},
) {
    const explicit = lendReversible(items, new Map(basePoints || []));
    const resolved = new Map();
    const visiting = new Set();
    const currencies = currencyIds || new Set(Object.keys(currencyValues));

    function valueOf(id) {
        if (resolved.has(id)) {
            return resolved.get(id);
        }
        if (visiting.has(id)) {
            return { value: null, source: 'cycle', incomplete: true };
        }
        visiting.add(id);
        let result = compute(id);
        const weight = weights?.[id];
        if (Number.isFinite(weight) && weight !== 1 && result.value !== null && !currencies.has(id)) {
            result = { ...result, value: result.value * weight, weight };
        }
        visiting.delete(id);
        resolved.set(id, result);
        return result;
    }

    function compute(id) {
        const item = items[id];
        if (ignored?.has(id)) {
            return { value: 0, source: 'ignored', incomplete: false };
        }
        if (currencies.has(id)) {
            const value = currencyValues[id];
            return { value: Number.isFinite(value) ? value : null, source: 'currency', incomplete: false };
        }
        if (explicit.has(id)) {
            return { incomplete: false, ...explicit.get(id) };
        }
        if (!item) {
            return { value: null, source: 'unknown', incomplete: true };
        }
        if (item.value_equivalent) {
            return { source: 'equivalent', ...sumContents(item.value_equivalent, valueOf) };
        }
        if (isRandomItem(item)) {
            let total = 0;
            let anyKnown = false;
            let incomplete = false;
            const parts = [];
            for (const drop of item.drop_table) {
                const r = sumContents(drop.contains, valueOf, drop.probability);
                parts.push(...r.parts);
                incomplete = incomplete || r.incomplete;
                if (r.value !== null) {
                    anyKnown = true;
                    total += r.value;
                }
            }
            return { value: anyKnown ? total : null, source: 'random', incomplete, parts };
        }
        if (isChoiceItem(item)) {
            return { source: 'choice', ...bestChoices(item.choice, valueOf) };
        }
        if (item.contains) {
            return { source: 'contains', ...sumContents(item.contains, valueOf) };
        }
        if (item.substitutes_for) {
            const targets = Array.isArray(item.substitutes_for)
                ? item.substitutes_for.map((targetId) => [targetId, 1])
                : Object.entries(item.substitutes_for);
            let best = null;
            for (const [targetId, qty] of targets) {
                const r = sumContents({ [targetId]: qty }, valueOf);
                if (r.value !== null && (best === null || r.value > best.value)) {
                    best = r;
                }
            }
            return best ? { source: 'substitute', ...best } : { value: null, source: 'unknown', incomplete: true };
        }
        if (item.crafted_from) {
            // No pack prices it: worth what crafting it takes.
            return { source: 'recipe', ...sumContents(item.crafted_from, valueOf) };
        }
        return { value: null, source: 'unknown', incomplete: true };
    }

    for (const id of Object.keys(items)) {
        valueOf(id);
    }
    return resolved;
}

/**
 * Points of a package / reward bundle: its `contains` plus its best `choice` options.
 * Returns `{ value, incomplete, parts, picked }` (value 0 rather than null for an empty bundle).
 */
function bundleValue({ contains, choice } = {}, values) {
    const valueOf = (id) => values.get(id) || { value: null };
    const base = sumContents(contains || {}, valueOf);
    let value = base.value ?? 0;
    let incomplete = base.incomplete;
    let parts = base.parts;
    let picked = null;
    if (choice) {
        const best = bestChoices(choice, valueOf);
        value += best.value ?? 0;
        incomplete = incomplete || best.incomplete;
        parts = parts.concat(best.parts);
        picked = best.picked;
    }
    return { value, incomplete, parts, picked };
}

export { resolveItemValues, bundleValue, sumContents, bestChoices, lendReversible };
