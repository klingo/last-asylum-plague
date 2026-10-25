/**
 * The coloured ratio with a small bar (Ranking, Events, Spend Rewards, Best Choice Pick). Number and
 * bar share one colour on a fixed scale around 1.0 (the worth-it line at your weekly spend): red at
 * 0.85 and below, amber at 1.0 (barely worth it: you gain next to nothing), green from 1.15 up,
 * blended in between. The bar's length shows the ratio relative to the best one in the table.
 */
import { formatThousands } from './format.js';

// --bad, --warn, --good (see style.css).
const RATIO_BAD_RGB = [242, 104, 92];
const RATIO_WARN_RGB = [242, 193, 78];
const RATIO_GOOD_RGB = [99, 214, 138];
// Ratio -> colour stops: red up to 0.85, amber at 1.0, green from 1.15.
const RATIO_STOPS = [
    [0.85, RATIO_BAD_RGB],
    [1, RATIO_WARN_RGB],
    [1.15, RATIO_GOOD_RGB],
];

function mixColor(from, to, fraction) {
    const channel = (i) => Math.round(from[i] + (to[i] - from[i]) * fraction);
    return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/** Colour of a ratio on the fixed scale around 1.0. */
function ratioColor(ratio) {
    if (ratio <= RATIO_STOPS[0][0]) {
        return mixColor(RATIO_BAD_RGB, RATIO_BAD_RGB, 0);
    }
    for (let i = 1; i < RATIO_STOPS.length; i++) {
        const [upper, toRgb] = RATIO_STOPS[i];
        const [lower, fromRgb] = RATIO_STOPS[i - 1];
        if (ratio <= upper) {
            return mixColor(fromRgb, toRgb, (ratio - lower) / (upper - lower));
        }
    }
    return mixColor(RATIO_GOOD_RGB, RATIO_GOOD_RGB, 0);
}

/** Colour of a position between the worst (0) and the best (1), red -> green ("vs. best", the Calendar's weekday offers). */
function shareColor(fraction) {
    return mixColor(RATIO_BAD_RGB, RATIO_GOOD_RGB, fraction);
}

/**
 * `ratio` as a coloured number over a bar scaled to `maxRatio` (at least 1). With `label`, that
 * text is shown instead of the number, coloured like the bar (for shares such as "vs. best" where
 * 1.0 isn't a worth-it line).
 */
function ratioBarHtml(ratio, maxRatio, { digits = 2, label = null } = {}) {
    if (!Number.isFinite(ratio)) {
        return '';
    }
    const fraction = Math.min(1, Math.max(0, ratio / Math.max(1, maxRatio)));
    const color = label === null ? ratioColor(ratio) : shareColor(fraction);
    const number = `<span style="color: ${color}">${label === null ? formatThousands(ratio, digits) : label}</span>`;
    return `
        <div class="ratio-display">
            ${number}
            <span class="ratio-bar"><span class="ratio-bar__fill" style="width: ${(fraction * 100).toFixed(1)}%; background: ${color}"></span></span>
        </div>`;
}

export { ratioBarHtml, ratioColor, shareColor };
