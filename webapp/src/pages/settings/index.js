/**
 * Settings (the cogwheel in the header): the language, the settings that shape every value (Count VIP points in the
 * worth) and the model quality: how well the fitted worths reproduce the packs' deal % (`fitItemPoints` diagnostics, the packs
 * furthest off, and how well each pack is predicted from the others: `fitHoldOut`, computed in the background),
 * and the collapsed Admin section that records runs through GitHub (admin.js).
 */
import { startPage } from '../../ui/page.js';
import '../../styles/pages/settings.css';
import { getSettings, updateSettings } from '../../ui/settings.js';
import { zeroFitItems } from '../../core/settings-model.js';
import { hydrateItemIcons, statHtml } from '../../ui/html.js';
import { pointFit } from '../../ui/valuation.js';
import { fitHoldOut, sensitivityFamilies } from '../../core/point-fit.js';
import { packageDisplayName } from '../../ui/labels.js';
import { formatPercent, formatThousands } from '../../ui/format.js';
import { infoIconHtml } from '../../ui/info-icon.js';
import { enableInfoTooltips } from '../../ui/tooltip.js';
import { LOCALES, getLocale, setLocale, t } from '../../ui/i18n.js';
import { notificationsSupported, requestNotificationPermission } from '../../ui/notifications.js';
import { initAdmin, renderAdmin } from './admin.js';

let data = null;
const WORST_COUNT = 3;
const WITHIN = 0.25;
// Error (how far a pack's fitted contents are from what its deal % says) up to which the typical pack, fitted or
// predicted from the others, counts as well fitted (green) and as usable (amber); above that it is poor (red).
// The packs in the list are outliers, which are allowed more.
const TYPICAL_LIMITS = { good: 0.1, warn: 0.2 };
const PACK_LIMITS = { good: 0.3, warn: 0.5 };

const tone = (error, limits) => (error <= limits.good ? 'text-good' : error <= limits.warn ? 'text-warn' : 'text-bad');
const ofTotal = (count, total) =>
    t('settings.quality.ofTotal', { count: formatThousands(count, 0), total: formatThousands(total, 0) });

// Median error of the packs predicted from the others, per fit (it takes about a second, see startHoldOut).
const holdOutErrors = new WeakMap();
let holdOutRun = 0;

/** The held-out figure shown for `fit`: its value once known (coloured), else a placeholder. */
function holdOutValue(fit) {
    return holdOutErrors.has(fit)
        ? { text: formatPercent(holdOutErrors.get(fit)), className: tone(holdOutErrors.get(fit), TYPICAL_LIMITS) }
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
        statHtml(`${label} ${infoIconHtml(info)}`, value, className, id);
    document.getElementById('fit-stats').innerHTML = [
        stat(
            t('settings.quality.median'),
            t('settings.quality.medianInfo'),
            formatPercent(diagnostics.medianError),
            tone(diagnostics.medianError, TYPICAL_LIMITS),
        ),
        stat(
            t('settings.quality.within', { limit: `${WITHIN * 100} %` }),
            t('settings.quality.withinInfo', { limit: `${WITHIN * 100} %` }),
            ofTotal(errors.filter((error) => error <= WITHIN).length, errors.length),
        ),
        stat(
            t('settings.quality.holdOut'),
            t('settings.quality.holdOutInfo', {
                packages: formatThousands(diagnostics.packages.length, 0),
                parameters: formatThousands(diagnostics.parameters, 0),
            }),
            holdOutValue(fit).text,
            holdOutValue(fit).className,
            'fit-holdout',
        ),
        stat(
            t('settings.quality.uncertain'),
            t('settings.quality.uncertainInfo'),
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
            const error = `${sign}${formatPercent(Math.abs(ratio - 1), 0)}`;
            return `<li>${name} <span class="${tone(Math.abs(ratio - 1), PACK_LIMITS)}">${error}</span></li>`;
        });
    document.getElementById('fit-worst').innerHTML = worst.join('');
}

/** Highlights the line of a setting's row that describes the switch's state (the other one is dimmed). */
function showSettingState(input) {
    const state = input.checked ? 'on' : 'off';
    for (const line of input.closest('.setting-row').querySelectorAll('.setting-row__state')) {
        line.classList.toggle('setting-row__state--active', line.dataset.state === state);
    }
}

/** One setting's switch: shows the stored value with the line describing it highlighted (the other one dimmed). */
function wireSetting(id, key) {
    const input = document.getElementById(id);
    input.checked = getSettings()[key] === true;
    showSettingState(input);
    input.addEventListener('change', () => {
        updateSettings({ [key]: input.checked });
        showSettingState(input);
        renderQuality();
    });
}

/** The language choice: switching it translates the page (i18n.js). */
function wireLanguage() {
    const select = document.getElementById('lang-select');
    select.innerHTML = Object.entries(LOCALES)
        .map(([code, { label }]) => `<option value="${code}">${label}</option>`)
        .join('');
    select.value = getLocale();
    select.addEventListener('change', () => setLocale(select.value));
}

// Why notifications can't be on (the text key), shown under the switch; null = nothing to say.
let notifyNote = null;

function renderNotifyNote() {
    const note = document.getElementById('notify-note');
    note.hidden = notifyNote === null;
    note.textContent = notifyNote === null ? '' : t(notifyNote);
}

/**
 * The Survival Battle notification switch. Switching it on asks the browser for permission (from this click); if it
 * isn't given, or there are no notifications in this browser, the switch goes back off and says why.
 */
function wireNotifications() {
    const input = document.getElementById('notify-survival-battle');
    input.checked = getSettings().notifySurvivalBattle === true;
    showSettingState(input);
    if (input.checked && (!notificationsSupported() || Notification.permission !== 'granted')) {
        // Still on, but the browser no longer allows it: nothing will be shown.
        notifyNote = 'settings.notifications.revoked';
    }
    renderNotifyNote();
    input.addEventListener('change', async () => {
        notifyNote = null;
        if (input.checked) {
            const permission = await requestNotificationPermission();
            if (permission !== 'granted') {
                input.checked = false;
                notifyNote =
                    permission === 'unsupported'
                        ? 'settings.notifications.unsupported'
                        : 'settings.notifications.denied';
            }
        }
        updateSettings({ notifySurvivalBattle: input.checked });
        showSettingState(input);
        renderNotifyNote();
    });
}

startPage('settings', {
    init(packData) {
        data = packData;
        hydrateItemIcons(document.querySelector('.settings-values'));
        wireSetting('count-vip-points', 'vipPointsInWorth');
        wireNotifications();
        wireLanguage();
        renderQuality();
        initAdmin(packData);
    },
    onLocaleChange() {
        renderQuality();
        renderNotifyNote();
        renderAdmin();
    },
});
