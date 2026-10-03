/**
 * The shared settings controls (weekly Banknote spend, events and spend tracks running this
 * week), rendered into a page's container. Changes are persisted via settings.js and reported
 * through `onChange(settings)`. Settings without a control here (item priorities) are changed
 * through the returned `update(patch)`, so everything is persisted in one place.
 *
 * `fields`: which controls to show, any of 'budget', 'events', 'passes'.
 */
import { localizedName, applyStaticTranslations } from './i18n';
import { loadSettings, saveSettings } from './settings';
import { expandPackageFamilies, packageFamilyId } from './catalog.js';

/** Seasonal package families (one entry per tier ladder): [familyId, { name }]. */
function passFamilies(packages) {
    const families = new Map();
    for (const [id, pkg] of Object.entries(expandPackageFamilies(packages || {}))) {
        if (pkg.seasonal && !families.has(packageFamilyId(id, pkg))) {
            families.set(packageFamilyId(id, pkg), { name: pkg.name });
        }
    }
    return [...families];
}

const ALL_FIELDS = ['budget', 'events', 'passes'];

function checkboxGroupHtml(name, labelKey, entries) {
    if (entries.length === 0) {
        return '';
    }
    const boxes = entries
        .map(
            ([id, entry]) =>
                `<label class="checkbox-label"><input type="checkbox" name="${name}" value="${id}" /><span>${localizedName(entry.name)}</span></label>`,
        )
        .join('');
    return `
        <div class="field">
            <span class="field-label" data-i18n="${labelKey}"></span>
            <div class="checkbox-group">${boxes}</div>
        </div>`;
}

function mountValuationPanel(container, data, { fields = ALL_FIELDS, onChange } = {}) {
    let settings = loadSettings();
    const show = new Set(fields);
    const sorted = (object) =>
        Object.entries(object || {}).sort(([, a], [, b]) => localizedName(a.name).localeCompare(localizedName(b.name)));

    function renderControls() {
        container.innerHTML = `
            <div class="form-row">
                ${
                    show.has('budget')
                        ? `<div class="field field--narrow">
                            <label for="vp-budget" data-i18n="valuation.budgetLabel"></label>
                            <input id="vp-budget" type="number" min="0" step="1000" />
                        </div>`
                        : ''
                }
                ${show.has('events') ? checkboxGroupHtml('vp-event', 'valuation.eventsLabel', sorted(data.events)) : ''}
                ${show.has('passes') ? checkboxGroupHtml('vp-pass', 'valuation.passesLabel', sorted(Object.fromEntries(passFamilies(data.packages)))) : ''}
            </div>`;
        applyStaticTranslations(container);
        const budgetInput = container.querySelector('#vp-budget');
        if (budgetInput) {
            budgetInput.value = String(settings.budget);
            budgetInput.addEventListener('change', () =>
                update({ budget: Math.max(0, Number(budgetInput.value) || 0) }),
            );
        }
        for (const [name, key] of [['vp-event', 'activeEvents']]) {
            const boxes = [...container.querySelectorAll(`input[name="${name}"]`)];
            for (const box of boxes) {
                box.checked = settings[key].includes(box.value);
                box.addEventListener('change', () =>
                    update({ [key]: boxes.filter((b) => b.checked).map((b) => b.value) }),
                );
            }
        }
        // Seasonal passes: ticked = on sale; stored as the unticked ones.
        const passBoxes = [...container.querySelectorAll('input[name="vp-pass"]')];
        for (const box of passBoxes) {
            box.checked = !settings.unavailablePasses.includes(box.value);
            box.addEventListener('change', () =>
                update({ unavailablePasses: passBoxes.filter((b) => !b.checked).map((b) => b.value) }),
            );
        }
    }

    function update(patch) {
        settings = { ...settings, ...patch };
        saveSettings(settings);
        onChange?.(settings);
    }

    renderControls();
    window.addEventListener('localechange', renderControls);

    return {
        getSettings: () => settings,
        update,
    };
}

export { mountValuationPanel };
