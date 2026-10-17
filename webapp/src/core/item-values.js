/**
 * Resolves every item's worth in POINTS, the relative value scale of the weekly plan (1 point is
 * roughly what the in-game deal % counts one diamond as).
 *
 * Resolution order per item:
 *   1. a currency (diamonds, coins) -> whatever the caller says it's worth (`currencyValues`)
 *   2. base points                  -> the caller's `basePoints` (fitted from deal %, see point-fit.js)
 *   3. by its kind (items.js): `value_equivalent` = sum of the listed items, random `drop_table` =
 *      expected value, `choice` = best `select_count` options, `contains` = sum, `substitutes_for` =
 *      best target, `crafted_from` = its ingredients
 *   4. otherwise unknown (null)
 * A `reversible` item with base points also lends them downward to its single content item
 * (e.g. Tempered Steel = 4 Refined Iron -> Refined Iron = value / 4), so a crafting chain only
 * needs one value.
 *
 * Unknown parts count as 0 and mark the result `incomplete`; a result with no known part at all
 * stays unknown. Pure module (no DOM/i18n), shared with Node scripts.
 */
import { itemKind, substituteTargets } from './items.js';

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
 * - `weights`: `{ itemId: factor }`, how much an item matters to the user (1 = as valued). Applied
 *   after everything else, so containers pick up their weighted contents and a weight on a
 *   container multiplies on top.
 */
function resolveItemValues(items, { basePoints = null, currencyValues = {}, currencyIds = null, weights = null } = {}) {
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
        if (currencies.has(id)) {
            const value = currencyValues[id];
            return { value: Number.isFinite(value) ? value : null, source: 'currency', incomplete: false };
        }
        if (explicit.has(id)) {
            return { incomplete: false, ...explicit.get(id) };
        }
        const item = items[id];
        switch (itemKind(item)) {
            case 'equivalent':
                return { source: 'equivalent', ...sumContents(item.value_equivalent, valueOf) };
            case 'random': {
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
            case 'choice':
                return { source: 'choice', ...bestChoices(item.choice, valueOf) };
            case 'contains':
                return { source: 'contains', ...sumContents(item.contains, valueOf) };
            case 'substitute': {
                let best = null;
                for (const [targetId, qty] of substituteTargets(item)) {
                    const r = sumContents({ [targetId]: qty }, valueOf);
                    if (r.value !== null && (best === null || r.value > best.value)) {
                        best = r;
                    }
                }
                return best ? { source: 'substitute', ...best } : { value: null, source: 'unknown', incomplete: true };
            }
            case 'recipe':
                // No pack prices it: worth what crafting it takes.
                return { source: 'recipe', ...sumContents(item.crafted_from, valueOf) };
            default:
                // A leaf the fit couldn't price, or an item the data doesn't have.
                return { value: null, source: 'unknown', incomplete: true };
        }
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
