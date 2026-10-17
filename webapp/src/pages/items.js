import { startPage } from '../ui/page.js';
import { buildValuation, modelSummaryText } from '../ui/valuation.js';
import { withLoading } from '../ui/loading.js';
import { fitSensitivity, sensitivityFamilies, isDependent } from '../core/point-fit.js';
import { currencyItemIds } from '../core/catalog.js';
import { isContainerItem, itemChainTops } from '../core/item-sources.js';
import { DEFAULT_SETTINGS, PRIORITY_LEVELS, getSettings, updateSettings, onSettingsChange } from '../ui/settings.js';
import { itemDisplayName } from '../ui/labels.js';
import { infoIconHtml } from '../ui/info-icon.js';
import { enableInfoTooltips } from '../ui/tooltip.js';
import { banknotesHtml, itemIconSlot, hydrateItemIcons } from '../ui/html.js';
import { formatSignificant, formatThousands } from '../ui/format.js';
import { t, getLocale, localizedName, enumLabel } from '../ui/i18n.js';

const searchInput = document.getElementById('search-input');
const changedOnly = document.getElementById('changed-only');
const resetButton = document.getElementById('reset-priorities');
const itemsSummary = document.getElementById('items-summary');
const itemsTable = document.getElementById('items-table');
const categoryJump = document.getElementById('category-jump');
const itemsEmpty = document.getElementById('items-empty');

let data = null;
let valuation = null;
let currencies = new Set();
// Chains (4 Cloth ⇄ 1 Leather ⇄ ... ⇄ 1 Tempered Steel; Lv.1 → Lv.5 raven gear by value): base item -> top item.
let chainTops = new Map();
// The level at the start of a chain item's name ("Lv.5 Sharp Beak", "LV5 ...").
const LEVEL_PREFIX = /^(lv\.?\s*\d+)\s+/i;
// Leave-one-out results of the deal % fit (computed in the background after the first render).
let sensitivity = null;

function priorityOf(id) {
    return getSettings().priorities[id] || 'normal';
}

function setPriority(id, level) {
    const priorities = { ...getSettings().priorities };
    if (level === 'normal') {
        delete priorities[id];
    } else {
        priorities[id] = level;
    }
    updateSettings({ priorities });
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
    // Worth 0 anyway at Don't care: how sure its worth is doesn't matter.
    if (priorityOf(id) === 'none') {
        return '';
    }
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
    return text === null ? t('common.unknown') : banknotesHtml(text);
}

function render() {
    const locale = getLocale();
    const search = searchInput.value.trim().toLowerCase();
    const rows = Object.entries(data.items)
        // Items made of other items (chests, supplies, choice chests, omni shards, the gear-material chain above
        // Cloth): their worth follows the items they contain, so they aren't listed, unless they still have a
        // priority of their own (e.g. from the old ignore list), so it can be seen and reset.
        .filter(([id, item]) => !currencies.has(id) && (!isContainerItem(item) || priorityOf(id) !== 'normal'))
        // A chain base (Cloth) is shown as its top item (Tempered Steel); the priority stays on the base.
        // A level chain is named without its level ("Sharp Beak", not "Lv.5 Sharp Beak"): the priority
        // covers every level. The level moves next to the worth, which is the top item's.
        .map(([id, item]) => {
            const shownId = chainTops.get(id) ?? id;
            const fullName = itemDisplayName(data.items, shownId, locale);
            const level = shownId !== id ? fullName.match(LEVEL_PREFIX) : null;
            return {
                id,
                shownId,
                item: data.items[shownId] ?? item,
                name: level ? fullName.slice(level[0].length) : fullName,
                level: level ? level[1] : null,
            };
        })
        .filter(({ id }) => !changedOnly.checked || priorityOf(id) !== 'normal')
        .filter(
            ({ id, name, item }) =>
                !search || `${id} ${name} ${enumLabel('category', item.category)}`.toLowerCase().includes(search),
        )
        .sort(
            (a, b) =>
                enumLabel('category', a.item.category).localeCompare(enumLabel('category', b.item.category)) ||
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
                `<a href="#cat-${category}" class="pill">${enumLabel('category', category)} (${members.length})</a>`,
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
                <tr class="table-group" id="cat-${category}"><th colspan="3">${enumLabel('category', category)}</th></tr>
                ${members
                    .map(
                        ({ id, shownId, name, level }) => `
                <tr>
                    <td><span class="item-cell">${itemIconSlot(shownId)}${name}${shownId === id && isContainerItem(data.items[id]) ? ` <span class="text-dim">(${t('items.derivedNote')})</span>` : ''}</span></td>
                    <td>${priorityHtml(id)}</td>
                    <td class="text-right">${worthHtml(shownId)}${level ? ` <span class="text-dim">(${level})</span>` : ''}${uncertainHtml(id)}</td>
                </tr>`,
                    )
                    .join('')}`,
                )
                .join('')}</tbody>`
        : '';
    hydrateItemIcons(itemsTable);
    enableInfoTooltips(itemsTable);
    const changed = Object.keys(getSettings().priorities).length;
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

startPage('items', {
    async init(loaded) {
        data = loaded;
        currencies = currencyItemIds(data.exchange_shops);
        chainTops = itemChainTops(data.items);
        // No setup bar here: the worth column uses the weekly spend set on the other pages.
        onSettingsChange((settings) => recompute(settings));
        // One listener for every priority radio in the table.
        itemsTable.addEventListener('change', (event) => {
            const id = event.target.getAttribute?.('data-priority');
            if (id) {
                setPriority(id, event.target.value);
            }
        });
        searchInput.addEventListener('input', render);
        changedOnly.addEventListener('change', render);
        resetButton.addEventListener('click', () => updateSettings({ priorities: { ...DEFAULT_SETTINGS.priorities } }));
        await recompute(getSettings());
    },
    onLocaleChange: render,
});
