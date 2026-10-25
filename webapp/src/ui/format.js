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

/**
 * Formats a worth/points value that can span many orders of magnitude (raw resources are worth
 * fractions of a millionth per unit, a Lv.5 raven item thousands): whole numbers with thousand
 * separators from 100 up, 2 decimals from 1 up, and `digits` significant digits below 1.
 */
function formatSignificant(value, digits = 3) {
    if (!Number.isFinite(value)) {
        return null;
    }
    const abs = Math.abs(value);
    if (abs === 0) {
        return '0';
    }
    if (abs >= 100) {
        return formatThousands(value, 0);
    }
    if (abs >= 1) {
        return formatThousands(value, 2);
    }
    const decimals = Math.min(12, digits - 1 - Math.floor(Math.log10(abs)));
    return value.toFixed(decimals);
}

export { formatThousands, formatSignificant, computeTieFlags };
