/**
 * The shared settings (weekly Banknote spend, events running this week, seasonal passes on sale), rendered
 * into a page's container as a compact setup bar: a one-line summary of the current setup and an "Edit"
 * button that opens the controls below it (spend | events | passes; toggle chips for events and passes).
 * Changes go to the settings store (settings.js `updateSettings`); pages listen with `onSettingsChange`.
 *
 * `fields`: which controls to show, any of 'budget', 'events', 'passes'.
 */
import { localizedName, applyStaticTranslations, t, tHtml } from './i18n.js';
import { getSettings, updateSettings, onSettingsChange, SETTINGS_KEY } from './settings.js';
import { packageFamilyId } from '../core/pack-data.js';
import { escapeHtml } from './html.js';
import { banknoteIconHtml } from './images.js';
import { formatThousands } from './format.js';

// Whether the setup panel is open: a UI preference (not a setting, so toggling doesn't recompute).
const OPEN_KEY = 'lasps_setup_open';

/** Seasonal package families (one entry per tier ladder): [familyId, { name }]. */
function passFamilies(packages) {
    const families = new Map();
    for (const [id, pkg] of Object.entries(packages || {})) {
        if (pkg.seasonal && !families.has(packageFamilyId(id, pkg))) {
            families.set(packageFamilyId(id, pkg), { name: pkg.name });
        }
    }
    return [...families];
}

const ALL_FIELDS = ['budget', 'events', 'passes'];

function loadOpen() {
    try {
        const stored = window.localStorage.getItem(OPEN_KEY);
        // First visit (nothing set up yet): open, so the settings are seen.
        return stored === null ? window.localStorage.getItem(SETTINGS_KEY) === null : stored === '1';
    } catch {
        return false;
    }
}

function saveOpen(open) {
    try {
        window.localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
        // localStorage may be unavailable (private browsing, etc.)
    }
}

/** A labelled group of toggle chips (events / passes) for the settings list `key`. */
function chipGroupHtml(key, labelKey, entries) {
    if (entries.length === 0) {
        return '';
    }
    const chips = entries
        .map(
            ([id, entry]) =>
                `<button type="button" class="toggle-chip" data-key="${key}" data-value="${id}" aria-pressed="false">${escapeHtml(localizedName(entry.name))}</button>`,
        )
        .join('');
    return `
        <div class="setup-panel__group">
            <span class="field-label" data-i18n="${labelKey}"></span>
            <div class="toggle-chips">${chips}</div>
        </div>`;
}

function mountValuationPanel(container, data, { fields = ALL_FIELDS } = {}) {
    let open = loadOpen();
    const show = new Set(fields);
    const sorted = (object) =>
        Object.entries(object || {}).sort(([, a], [, b]) => localizedName(a.name).localeCompare(localizedName(b.name)));
    const passes = sorted(Object.fromEntries(passFamilies(data.packages)));
    // In-game events (category "ingame_event": no packs, no shop) are only tracked in the data's `schedule`,
    // not offered here.
    const shoppableEvents = Object.fromEntries(
        Object.entries(data.events || {}).filter(([, event]) => event.category !== 'ingame_event'),
    );

    /** "🪙 20,000 / week · Events: … · Passes: …" for the page's fields. */
    function renderSummary() {
        const settings = getSettings();
        const summary = container.querySelector('.setup-bar__summary');
        if (!summary) {
            return;
        }
        const names = (ids, lookup) => {
            const list = ids.map((id) => lookup(id)).filter(Boolean);
            return list.length > 0 ? list.map(escapeHtml).join(', ') : t('valuation.none');
        };
        const parts = [];
        if (show.has('budget')) {
            parts.push(
                `${banknoteIconHtml()} ${tHtml('valuation.summaryBudget', { amount: `<strong>${formatThousands(settings.budget, 0)}</strong>` })}`,
            );
        }
        if (show.has('events')) {
            const eventName = (id) => (data.events?.[id] ? localizedName(data.events[id].name) : null);
            parts.push(tHtml('valuation.summaryEvents', { list: names(settings.activeEvents, eventName) }));
        }
        if (show.has('passes')) {
            const passName = (id) => {
                const entry = passes.find(([familyId]) => familyId === id);
                return entry ? localizedName(entry[1].name) : null;
            };
            parts.push(tHtml('valuation.summaryPasses', { list: names(settings.seasonalPasses, passName) }));
        }
        summary.innerHTML = parts.map((part) => `<span class="setup-chip">${part}</span>`).join('');
    }

    function renderToggle() {
        const toggle = container.querySelector('.setup-bar__toggle');
        const panel = container.querySelector('.setup-panel');
        if (!toggle || !panel) {
            return;
        }
        toggle.setAttribute('aria-expanded', String(open));
        toggle.textContent = open ? `${t('valuation.done')} ▴` : `${t('valuation.edit')} ▾`;
        panel.hidden = !open;
    }

    function renderControls() {
        container.innerHTML = `
            <div class="setup-bar">
                <div class="setup-bar__summary"></div>
                <button type="button" class="setup-bar__toggle" aria-controls="vp-panel"></button>
            </div>
            <div class="setup-panel" id="vp-panel">
                ${
                    show.has('budget')
                        ? `<div class="setup-panel__group">
                            <label class="field-label" for="vp-budget" data-i18n="valuation.budgetLabel"></label>
                            <input id="vp-budget" type="number" min="0" step="1000" />
                        </div>`
                        : ''
                }
                ${show.has('events') ? chipGroupHtml('activeEvents', 'valuation.eventsLabel', sorted(shoppableEvents)) : ''}
                ${show.has('passes') ? chipGroupHtml('seasonalPasses', 'valuation.passesLabel', passes) : ''}
            </div>`;
        applyStaticTranslations(container);
        renderSummary();
        renderToggle();
        container.querySelector('.setup-bar__toggle').addEventListener('click', () => {
            open = !open;
            saveOpen(open);
            renderToggle();
        });
        const budgetInput = container.querySelector('#vp-budget');
        if (budgetInput) {
            budgetInput.addEventListener('change', () =>
                updateSettings({ budget: Math.max(0, Number(budgetInput.value) || 0) }),
            );
        }
        for (const chip of container.querySelectorAll('.toggle-chip')) {
            const { key, value } = chip.dataset;
            chip.addEventListener('click', () => {
                const list = getSettings()[key];
                updateSettings({ [key]: list.includes(value) ? list.filter((id) => id !== value) : [...list, value] });
            });
        }
        renderValues();
    }

    /** The controls' values from the settings (also after a change made elsewhere). */
    function renderValues() {
        const settings = getSettings();
        const budgetInput = container.querySelector('#vp-budget');
        if (budgetInput) {
            budgetInput.value = String(settings.budget);
        }
        for (const chip of container.querySelectorAll('.toggle-chip')) {
            const { key, value } = chip.dataset;
            chip.setAttribute('aria-pressed', String(settings[key].includes(value)));
        }
    }

    renderControls();
    window.addEventListener('localechange', renderControls);
    onSettingsChange(() => {
        renderSummary();
        renderValues();
    });
}

export { mountValuationPanel };
