import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { buildValuation, modelSummaryText } from './lib/valuation';
import { mountValuationPanel } from './lib/valuation-panel';
import { withLoading } from './lib/loading';
import { fitSensitivity, sensitivityFamilies, isDependent } from './lib/point-fit.js';
import { currencyItemIds } from './lib/catalog.js';
import { DEFAULT_SETTINGS, PRIORITY_LEVELS } from './lib/settings';
import { itemDisplayName } from './lib/labels';
import { infoIconHtml } from './lib/requires-tooltip';
import { enableInfoTooltips } from './lib/tooltip';
import { createItemImage, banknoteIconHtml } from './lib/images';
import { formatSignificant, formatThousands } from './lib/format';
import { t, getLocale, localizedName, categoryLabel, applyStaticTranslations } from './lib/i18n';

renderNav('items');
applyStaticTranslations();

const searchInput = document.getElementById('search-input');
const changedOnly = document.getElementById('changed-only');
const resetButton = document.getElementById('reset-priorities');
const itemsSummary = document.getElementById('items-summary');
const itemsTable = document.getElementById('items-table');
const categoryJump = document.getElementById('category-jump');
const itemsEmpty = document.getElementById('items-empty');

let data = null;
let panel = null;
let valuation = null;
let currencies = new Set();
// Leave-one-out results of the deal % fit (computed in the background after the first render).
let sensitivity = null;

function priorityOf(id) {
    return panel.getSettings().priorities[id] || 'normal';
}

function setPriority(id, level) {
    const priorities = { ...panel.getSettings().priorities };
    if (level === 'normal') {
        delete priorities[id];
    } else {
        priorities[id] = level;
    }
    panel.update({ priorities });
}

function priorityHtml(id) {
    const current = priorityOf(id);
    const options = PRIORITY_LEVELS.map(
        (level) => `
            <label class="priority-option ${level === current ? 'priority-option--active' : ''}">
                <input type="radio" name="priority-${id}" value="${level}" data-priority="${id}" ${level === current ? 'checked' : ''} />
                <span>${t(`items.priority.${level}`)}</span>
            </label>`,
    ).join('');
    return `<div class="priority-group" role="radiogroup" aria-label="${t('items.table.priority')}">${options}</div>`;
}

/** Display name of a package family (the unit the sensitivity check leaves out). */
function familyName(familyId) {
    const pkg =
        data.packages[familyId] || Object.entries(data.packages).find(([id]) => id.startsWith(`${familyId}_t`))?.[1];
    return localizedName(pkg?.name) || familyId;
}

/** "uncertain" marker with the reason as tooltip, or ''. */
function uncertainHtml(id) {
    const entry = valuation.fit.points.get(id);
    const dependence = sensitivity?.get(id);
    const reasons = [];
    if (entry?.uncertain) {
        reasons.push(t('items.uncertainTitle'));
    }
    if (entry?.source === 'fit' && isDependent(dependence)) {
        const pack = familyName(dependence.family);
        reasons.push(
            Number.isFinite(dependence.factor)
                ? t('items.dependsOn', { factor: formatThousands(dependence.factor, 1), pack })
                : t('items.onlyFrom', { pack }),
        );
    }
    return reasons.length
        ? ` <span class="uncertain-note"><span class="text-dim">${t('items.uncertain')}</span>${infoIconHtml(reasons.join(' '))}</span>`
        : '';
}

function worthHtml(id) {
    const worth = valuation.worth(id);
    const text = formatSignificant(worth);
    return text === null ? t('common.unknown') : `<span class="text-gold">${text}</span> ${banknoteIconHtml()}`;
}

function render() {
    const locale = getLocale();
    const search = searchInput.value.trim().toLowerCase();
    const rows = Object.entries(data.items)
        .filter(([id]) => !currencies.has(id))
        .map(([id, item]) => ({ id, item, name: itemDisplayName(data.items, id, locale) }))
        .filter(({ id }) => !changedOnly.checked || priorityOf(id) !== 'normal')
        .filter(
            ({ id, name, item }) =>
                !search || `${id} ${name} ${categoryLabel(item.category)}`.toLowerCase().includes(search),
        )
        .sort(
            (a, b) =>
                categoryLabel(a.item.category).localeCompare(categoryLabel(b.item.category)) ||
                a.name.localeCompare(b.name),
        );
    itemsEmpty.hidden = rows.length > 0;
    // Grouped by category, with a jump link per group.
    const groups = new Map();
    for (const row of rows) {
        const category = row.item.category;
        if (!groups.has(category)) {
            groups.set(category, []);
        }
        groups.get(category).push(row);
    }
    categoryJump.innerHTML = [...groups]
        .map(
            ([category, members]) =>
                `<a href="#cat-${category}" class="pill">${categoryLabel(category)} (${members.length})</a>`,
        )
        .join('');
    itemsTable.innerHTML = rows.length
        ? `<thead><tr>
                <th>${t('items.table.item')}</th>
                <th>${t('items.table.priority')}</th>
                <th class="text-right">${t('items.table.worth')}</th>
            </tr></thead><tbody>${[...groups]
                .map(
                    ([category, members]) => `
                <tr class="table-group" id="cat-${category}"><th colspan="3">${categoryLabel(category)}</th></tr>
                ${members
                    .map(
                        ({ id, name }) => `
                <tr>
                    <td><span class="item-cell"><span data-item-id="${id}"></span>${name}</span></td>
                    <td>${priorityHtml(id)}</td>
                    <td class="text-right">${worthHtml(id)}${uncertainHtml(id)}</td>
                </tr>`,
                    )
                    .join('')}`,
                )
                .join('')}</tbody>`
        : '';
    itemsTable.querySelectorAll('[data-item-id]').forEach((placeholder) => {
        const itemId = placeholder.getAttribute('data-item-id');
        placeholder.replaceWith(createItemImage(itemId, itemId, 'item-icon item-icon--sm'));
    });
    enableInfoTooltips(itemsTable);
    const changed = Object.keys(panel.getSettings().priorities).length;
    itemsSummary.textContent = `${t('items.summary', { count: changed })} ${modelSummaryText(valuation)}`;
}

/** Runs the leave-one-out check in ~100 ms slices so the page stays responsive, then re-renders. */
function startSensitivity() {
    if (sensitivity) {
        return;
    }
    const families = sensitivityFamilies(data);
    const result = new Map();
    let index = 0;
    const step = () => {
        const sliceStart = performance.now();
        while (index < families.length && performance.now() - sliceStart < 100) {
            fitSensitivity(data, valuation.fit, { families: [families[index]], into: result });
            index++;
        }
        if (index < families.length) {
            setTimeout(step, 0);
        } else {
            sensitivity = result;
            render();
        }
    };
    setTimeout(step, 0);
}

async function recompute(settings) {
    await withLoading(async () => {
        valuation = await buildValuation(data, settings);
        render();
    });
    startSensitivity();
}

async function init() {
    data = await loadPackData();
    currencies = currencyItemIds(data.exchange_shops);
    panel = mountValuationPanel(document.getElementById('valuation-panel'), data, {
        fields: ['budget'],
        onChange: (settings) => recompute(settings),
    });
    // One listener for every priority radio in the table.
    itemsTable.addEventListener('change', (event) => {
        const id = event.target.getAttribute?.('data-priority');
        if (id) {
            setPriority(id, event.target.value);
        }
    });
    searchInput.addEventListener('input', render);
    changedOnly.addEventListener('change', render);
    resetButton.addEventListener('click', () => panel.update({ priorities: { ...DEFAULT_SETTINGS.priorities } }));
    window.addEventListener('localechange', () => {
        applyStaticTranslations();
        render();
    });
    await recompute(panel.getSettings());
}

init().catch((error) => {
    console.error(error);
    document
        .querySelector('main')
        .insertAdjacentHTML(
            'afterbegin',
            `<div class="card"><p class="text-bad">${t('common.loadError', { message: error.message })}</p></div>`,
        );
});
