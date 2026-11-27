/**
 * Custom Package: values a pack the user types in, e.g. a one-time offer that isn't worth adding to the data. A pack
 * is `{ items, slots, price, deal }`: fixed `items` (`[{ id, qty }]`, up to MAX_ITEMS), `slots` ("choose 1" of up to
 * MAX_OPTIONS `{ id, qty }` options each, up to MAX_SLOTS of them), the Banknote `price` and the optional deal % the
 * game shows (`deal`, 0 = not given).
 *
 * The verdict is the one every pack gets (ui/valuation.js `bundle`): worth ÷ price at the user's weekly spend, a slot
 * counting at its best option as a data pack's `choice` does. The deal % is only a plausibility check (`dealCheck`):
 * what the game claims the contents are worth against what the model makes of them, the game's way (unweighted by the
 * user's priorities, which its deal % knows nothing of). It never enters the fit or the verdict.
 *
 * The pack lives in the page's URL: `items=<id>:<qty>,...`, `c1`, `c2`, `c3` (a slot's options, same form), `price`
 * and `deal`.
 */
import { currencyItemIds } from './catalog.js';
import { bundleValue, resolveItemValues } from './item-values.js';

const MAX_ITEMS = 10;
const MAX_SLOTS = 3;
const MAX_OPTIONS = 5;
// A deal % check is flagged when the model's points and the game's claim are further apart than this factor.
const FLAG_FACTOR = 1.5;

/** `"id:qty,id:qty"` -> `[{ id, qty }]` of the known items with a whole amount of 1 or more, at most `limit`. */
function parseEntries(text, items, limit) {
    const entries = [];
    for (const part of String(text || '').split(',')) {
        const [id, amount] = part.split(':');
        const qty = Math.floor(Number(amount));
        if (items[id] && qty >= 1) {
            entries.push({ id, qty });
        }
    }
    return entries.slice(0, limit);
}

/** `[{ id, qty }]` -> `"id:qty,id:qty"` (entries without an item or an amount left out), or null when none is left. */
function formatEntries(entries) {
    const text = entries
        .filter((entry) => entry.id && entry.qty >= 1)
        .map((entry) => `${entry.id}:${Math.floor(entry.qty)}`)
        .join(',');
    return text || null;
}

/** A pack from the page's query (`read(name)` gives a parameter or null): what is unknown or beyond the limits is left out. */
function parseCustomPack(read, items) {
    const slots = [];
    for (let index = 1; index <= MAX_SLOTS; index++) {
        const options = parseEntries(read(`c${index}`), items, MAX_OPTIONS);
        if (options.length > 0) {
            slots.push(options);
        }
    }
    const number = (name) => {
        const value = Number(read(name));
        return value > 0 ? value : 0;
    };
    return {
        items: parseEntries(read('items'), items, MAX_ITEMS),
        slots,
        price: number('price'),
        deal: number('deal'),
    };
}

/** The query parameters of a pack (see the header; null = not set), for `setUrlParams`. */
function customPackParams(pack) {
    const params = { items: formatEntries(pack.items), price: pack.price > 0 ? pack.price : null };
    pack.slots
        .map(formatEntries)
        .filter(Boolean)
        .forEach((text, index) => {
            params[`c${index + 1}`] = text;
        });
    params.deal = pack.deal > 0 ? pack.deal : null;
    return params;
}

/** The fixed items and the picked option of every slot as one `{ itemId: qty }` bundle. */
function packContents(pack, picks) {
    const contents = {};
    const add = ({ id, qty }) => {
        contents[id] = (contents[id] || 0) + qty;
    };
    pack.items.filter((entry) => entry.id && entry.qty >= 1).forEach(add);
    pack.slots.forEach((options, index) => {
        if (picks[index] >= 0) {
            add(options[picks[index]]);
        }
    });
    return contents;
}

/** Index of the option with the highest `valueOf`, the first of equals; -1 for no option. */
function bestOption(options, valueOf) {
    let best = -1;
    let bestValue = -Infinity;
    options.forEach((option, index) => {
        const value = valueOf(option);
        if (value > bestValue) {
            best = index;
            bestValue = value;
        }
    });
    return best;
}

/** `pack.slots` without the options that have no item or amount yet (the page keeps them while the user is typing). */
function filledSlots(pack) {
    return pack.slots.map((options) => options.filter((option) => option.id && option.qty >= 1));
}

/**
 * Values the pack. `bundleOf(contents, price)` is `valuation.bundle({ contains: contents }, price)`. Returns
 * `{ contents, slots, worth, points, ratio, incomplete, parts }`: `contents` the bundle valued (fixed items plus the
 * best option of every slot), `slots` the options of each slot with their `worth` and `incomplete` and the `picked`
 * index (-1 without options), the rest as `bundle` gives it (`ratio` is null without a price).
 */
function valueCustomPack(pack, bundleOf) {
    const filled = { ...pack, slots: filledSlots(pack) };
    const slots = filled.slots.map((options) => {
        const rated = options.map((option) => {
            const { worth, incomplete } = bundleOf({ [option.id]: option.qty }, 0);
            return { ...option, worth, incomplete };
        });
        return { options: rated, picked: bestOption(rated, (option) => option.worth) };
    });
    const contents = packContents(
        filled,
        slots.map((slot) => slot.picked),
    );
    const { worth, points, ratio, incomplete, parts } = bundleOf(contents, pack.price);
    return { contents, slots, worth, points, ratio, incomplete, parts };
}

/** The place `ratio` would take among the `ratios` of the packs on sale: `{ rank, total }` (total counts the pack). */
function dealRank(ratio, ratios) {
    return { rank: ratios.filter((other) => other > ratio).length + 1, total: ratios.length + 1 };
}

/**
 * The items' points as the game's deal % counts them: the fit's, no priorities. Diamonds are 1, an event coin has the
 * value the fit gave it (its offers tie it to the packs; a coin the fit leaves out, like the Star Moon Sigil, is unknown).
 */
function dealValues(data, fit) {
    const currencyIds = currencyItemIds(data);
    const currencyValues = Object.fromEntries(
        [...currencyIds].map((id) => [id, id === 'diamonds' ? 1 : fit.paramValues.get(id)]),
    );
    return resolveItemValues(data.items, { basePoints: fit.points, currencyIds, currencyValues });
}

/**
 * The deal % against the model, or null without a deal % and a price: `{ claim, points, factor, flagged, incomplete }`.
 * `claim` is what the game says the contents are worth in diamonds (price × deal % ÷ 100), `points` what the model makes
 * of them (`values` = `dealValues`, a slot at its best option), `factor` = points ÷ claim, `flagged` when they are more
 * than FLAG_FACTOR apart either way. `incomplete`: an item has no points (an unmodelled item, say), so `points` falls short.
 */
function dealCheck(pack, values) {
    if (!(pack.price > 0 && pack.deal > 0)) {
        return null;
    }
    const filled = { ...pack, slots: filledSlots(pack) };
    const valueOf = (option) => bundleValue({ contains: { [option.id]: option.qty } }, values).value;
    const picks = filled.slots.map((options) => bestOption(options, valueOf));
    const { value: points, incomplete } = bundleValue({ contains: packContents(filled, picks) }, values);
    const claim = (pack.price * pack.deal) / 100;
    const factor = points / claim;
    return { claim, points, factor, flagged: factor > FLAG_FACTOR || factor < 1 / FLAG_FACTOR, incomplete };
}

export {
    MAX_ITEMS,
    MAX_SLOTS,
    MAX_OPTIONS,
    parseCustomPack,
    customPackParams,
    valueCustomPack,
    dealRank,
    dealValues,
    dealCheck,
};
