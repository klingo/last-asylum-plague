/**
 * The coloured ratio with a small bar (Ranking, Spend Rewards): the number is green from 1.0 up
 * (worth it at your weekly spend) and red below; the bar's length and colour (red -> green) show
 * the ratio relative to the best one in the table.
 */
import { formatThousands } from './format';

// --bad -> --good (see style.css).
const RATIO_BAD_RGB = [242, 104, 92];
const RATIO_GOOD_RGB = [99, 214, 138];

function ratioBarColor(fraction) {
    const channel = (i) => Math.round(RATIO_BAD_RGB[i] + (RATIO_GOOD_RGB[i] - RATIO_BAD_RGB[i]) * fraction);
    return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
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
    const number =
        label === null
            ? `<span class="${ratio >= 1 ? 'text-good' : 'text-bad'}">${formatThousands(ratio, digits)}</span>`
            : `<span style="color: ${ratioBarColor(fraction)}">${label}</span>`;
    return `
        <div class="ratio-display">
            ${number}
            <span class="ratio-bar"><span class="ratio-bar__fill" style="width: ${(fraction * 100).toFixed(1)}%; background: ${ratioBarColor(fraction)}"></span></span>
        </div>`;
}

export { ratioBarHtml };
