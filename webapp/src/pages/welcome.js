import { startPage } from '../ui/page.js';
import { getSettings, updateSettings, zeroFitItems } from '../ui/settings.js';
import { hydrateItemIcons } from '../ui/html.js';
import { pointFit } from '../ui/valuation.js';
import { fitHoldOut, sensitivityFamilies } from '../core/point-fit.js';
import { packageDisplayName } from '../ui/labels.js';
import { formatThousands } from '../ui/format.js';
import { infoIconHtml } from '../ui/info-icon.js';
import { enableInfoTooltips } from '../ui/tooltip.js';
import { t } from '../ui/i18n.js';

// Home: the nav, static texts, the settings that shape every value and how well the fit matches the packs.

let data = null;
const PERCENT = '&nbsp;%';
const WORST_COUNT = 3;
const WITHIN = 0.25;
// Error (how far a pack's fitted contents are from what its deal % says) up to which the typical pack, fitted or
// predicted from the others, counts as well fitted (green) and as usable (amber); above that it is poor (red).
// The packs in the list are outliers, which are allowed more.
const TYPICAL_LIMITS = { good: 0.1, warn: 0.2 };
const PACK_LIMITS = { good: 0.3, warn: 0.5 };

const tone = (error, limits) => (error <= limits.good ? 'text-good' : error <= limits.warn ? 'text-warn' : 'text-bad');
const percent = (share) => `${formatThousands(share * 100, 1)}${PERCENT}`;
const ofTotal = (count, total) =>
    t('welcome.quality.ofTotal', { count: formatThousands(count, 0), total: formatThousands(total, 0) });

// Median error of the packs predicted from the others, per fit (it takes about a second, see startHoldOut).
const holdOutErrors = new WeakMap();
let holdOutRun = 0;

/** The held-out figure shown for `fit`: its value once known (coloured), else a placeholder. */
function holdOutValue(fit) {
    return holdOutErrors.has(fit)
        ? { text: percent(holdOutErrors.get(fit)), className: tone(holdOutErrors.get(fit), TYPICAL_LIMITS) }
        : { text: '…', className: '' };
}

function showHoldOut(fit) {
    const { text, className } = holdOutValue(fit);
    const element = document.getElementById('fit-holdout');
    element.innerHTML = text;
    element.className = `mine-stat__value ${className}`;
}

/** Fits without each package family in turn, in ~100 ms slices so the page stays responsive. */
function startHoldOut(fit, settings) {
    if (holdOutErrors.has(fit)) {
        return;
    }
    const run = ++holdOutRun;
    const families = sensitivityFamilies(data);
    const zeroItems = new Set(zeroFitItems(settings));
    const heldOut = [];
    let index = 0;
    const step = () => {
        if (run !== holdOutRun) {
            return;
        }
        const sliceStart = performance.now();
        while (index < families.length && performance.now() - sliceStart < 100) {
            fitHoldOut(data, fit, { zeroItems, families: [families[index]], into: heldOut });
            index++;
        }
        if (index < families.length) {
            setTimeout(step, 0);
            return;
        }
        const errors = heldOut.map((p) => Math.abs(p.ratio - 1)).sort((a, b) => a - b);
        holdOutErrors.set(fit, errors[Math.floor(errors.length / 2)]);
        showHoldOut(fit);
    };
    setTimeout(step, 0);
}

/** The fit's quality: how far the packs' fitted contents are from their deal % (diagnostics of point-fit.js). */
function renderQuality() {
    const settings = getSettings();
    const fit = pointFit(data, settings);
    const { diagnostics } = fit;
    const errors = diagnostics.packages.map((p) => Math.abs(p.ratio - 1));
    const fitted = [...fit.points.values()].filter((entry) => entry.source === 'fit' && entry.value > 0);
    // A tile: its title with an info icon (what the figure means), the value below.
    const stat = (label, info, value, className = '', id = '') =>
        `<div class="mine-stat"><div class="mine-stat__label">${label} ${infoIconHtml(info)}</div><div class="mine-stat__value ${className}"${id ? ` id="${id}"` : ''}>${value}</div></div>`;
    document.getElementById('fit-stats').innerHTML = [
        stat(
            t('welcome.quality.median'),
            t('welcome.quality.medianInfo'),
            percent(diagnostics.medianError),
            tone(diagnostics.medianError, TYPICAL_LIMITS),
        ),
        stat(
            t('welcome.quality.within', { limit: `${WITHIN * 100} %` }),
            t('welcome.quality.withinInfo', { limit: `${WITHIN * 100} %` }),
            ofTotal(errors.filter((error) => error <= WITHIN).length, errors.length),
        ),
        stat(
            t('welcome.quality.holdOut'),
            t('welcome.quality.holdOutInfo', {
                packages: formatThousands(diagnostics.packages.length, 0),
                parameters: formatThousands(diagnostics.parameters, 0),
            }),
            holdOutValue(fit).text,
            holdOutValue(fit).className,
            'fit-holdout',
        ),
        stat(
            t('welcome.quality.uncertain'),
            t('welcome.quality.uncertainInfo'),
            ofTotal(fitted.filter((entry) => entry.uncertain).length, fitted.length),
        ),
    ].join('');
    enableInfoTooltips(document.getElementById('fit-stats'));
    startHoldOut(fit, settings);
    const worst = [...diagnostics.packages]
        .sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1))
        .slice(0, WORST_COUNT)
        .map(({ id, ratio }) => {
            const sign = ratio >= 1 ? '+' : '−';
            const name = data.packages[id] ? packageDisplayName(data.packages[id]) : id;
            const error = `${sign}${formatThousands(Math.abs(ratio - 1) * 100, 0)}${PERCENT}`;
            return `<li>${name} <span class="${tone(Math.abs(ratio - 1), PACK_LIMITS)}">${error}</span></li>`;
        });
    document.getElementById('fit-worst').innerHTML = worst.join('');
}

/** One setting's switch: shows the stored value with the line describing it highlighted (the other one dimmed). */
function wireSetting(id, key) {
    const input = document.getElementById(id);
    const showState = () => {
        const state = input.checked ? 'on' : 'off';
        for (const line of input.closest('.setting-row').querySelectorAll('.setting-row__state')) {
            line.classList.toggle('setting-row__state--active', line.dataset.state === state);
        }
    };
    input.checked = getSettings()[key] === true;
    showState();
    input.addEventListener('change', () => {
        updateSettings({ [key]: input.checked });
        showState();
        renderQuality();
    });
}

startPage('welcome', {
    init(packData) {
        data = packData;
        hydrateItemIcons(document.querySelector('.welcome-settings'));
        wireSetting('count-vip-points', 'vipPointsInWorth');
        renderQuality();
    },
    onLocaleChange: renderQuality,
});
