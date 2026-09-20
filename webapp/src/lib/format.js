/**
 * The number of decimal places a per-unit Banknotes value needs, starting from `minDecimals`
 * and growing (up to `maxDecimals`) until at least one non-zero digit is visible. Some very
 * cheap-per-unit resources (e.g. Herbs, obtained in the tens of millions per purchase) round
 * away to "0.00" at a fixed low precision, which reads as free/unknown rather than merely
 * tiny.
 *
 * Once growing was actually needed (i.e. `minDecimals` alone wasn't enough), one extra decimal
 * is added on top of the first non-zero digit, up to `maxDecimals`, so a barely-visible value
 * like "0.00001" instead reads as "0.000014" — a second significant digit rather than just
 * clearing zero. Values that already fit at `minDecimals` are never affected by this.
 */
function unitPriceDecimals(value, { minDecimals = 2, maxDecimals = 10 } = {}) {
    let decimals = minDecimals;
    while (decimals < maxDecimals && value !== 0 && Number(value.toFixed(decimals)) === 0) {
        decimals++;
    }
    if (decimals > minDecimals) {
        decimals = Math.min(decimals + 1, maxDecimals);
    }
    return decimals;
}

/**
 * Formats a single per-unit Banknotes price at its own precision (see `unitPriceDecimals`).
 * Returns a string, not a number, so trailing zeros required by `minDecimals` are preserved
 * (e.g. "1.00" rather than "1", which `Number(...)` would silently collapse back down to).
 */
function formatUnitPrice(value, options = {}) {
    if (!Number.isFinite(value)) {
        return null;
    }
    return value.toFixed(unitPriceDecimals(value, options));
}

/**
 * Formats a whole column of per-unit Banknotes prices at one shared precision: whatever the
 * smallest (hardest to show) value in the column needs (see `unitPriceDecimals`). Every value
 * is padded to that same precision, so e.g. "1.00" lines up under "0.07" instead of each row
 * picking its own, inconsistent number of decimal places. Returns strings in the same order
 * as `values`, with `null` for non-finite entries.
 */
function formatUnitPriceColumn(values, options = {}) {
    const decimals = values.reduce(
        (max, value) => (Number.isFinite(value) ? Math.max(max, unitPriceDecimals(value, options)) : max),
        options.minDecimals ?? 2,
    );
    return values.map((value) => (Number.isFinite(value) ? value.toFixed(decimals) : null));
}

/**
 * Formats a number with apostrophe (') thousand separators, e.g. 1234567.89 -> "1'234'567.89".
 * With no `decimals` given, any decimal part `value` already has (from prior rounding) is
 * preserved as-is; only the integer part is grouped. When `decimals` is given, the value is
 * padded/rounded to exactly that many decimal places first, so every value in a column ends up
 * with the same number of decimals (e.g. "5.5000" lining up under "5.7721") instead of each row
 * showing however many non-zero decimals it happens to have.
 */
function formatThousands(value, decimals) {
    if (!Number.isFinite(value)) {
        return String(value);
    }
    const raw = Number.isFinite(decimals) ? Math.abs(value).toFixed(decimals) : Math.abs(value).toString();
    const [intPart, decPart] = raw.split('.');
    const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
    const sign = value < 0 ? '-' : '';
    return decPart ? `${sign}${groupedInt}.${decPart}` : `${sign}${groupedInt}`;
}

/**
 * For a list already sorted by rank (best first), flags every entry whose comparison `key`
 * exactly matches the immediately preceding entry's — i.e. it's tied for the same rank and its
 * rank number shouldn't be repeated on screen (competition ranking: 1, "", 3, not 1, 1, 3).
 * `keys` are compared with `===`, so pass values already rounded/formatted to whatever
 * precision is actually shown to the user (e.g. a rounded number or a formatted string) rather
 * than raw floating-point results, which could differ by float noise despite looking identical.
 * `null`/`undefined` keys (no comparable value at all, e.g. "N/A" rows) never tie with anything,
 * including each other.
 */
function computeTieFlags(keys) {
    return keys.map((key, index) => index > 0 && key !== null && key !== undefined && key === keys[index - 1]);
}

export { formatUnitPrice, formatUnitPriceColumn, formatThousands, computeTieFlags };
