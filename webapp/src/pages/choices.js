import { startPage } from '../ui/page.js';
import { buildValuation } from '../ui/valuation.js';
import { urlParam, setUrlParams } from '../ui/url.js';
import { mountValuationPanel } from '../ui/valuation-panel.js';
import { getSettings, onSettingsChange } from '../ui/settings.js';
import { withLoading } from '../ui/loading.js';
import { packageDisplayName, packageDisplayText, bundleLabel } from '../ui/labels.js';
import { createItemPicker } from '../ui/item-picker.js';
import { banknotesHtml, escapeHtml, itemIconSlot, hydrateItemIcons } from '../ui/html.js';
import { detailsToggleHtml, wireDetailsToggles, breakdownParts } from '../ui/grid.js';
import { formatThousands, formatSignificant, computeTieFlags } from '../ui/format.js';
import { ratioBarHtml } from '../ui/ratio-bar.js';
import { t, getLocale, enumLabel } from '../ui/i18n.js';

const itemPicker = createItemPicker({
    trigger: document.getElementById('item-search'),
    placeholderKey: 'choices.itemPlaceholder',
    onChange: () => {
        render();
        syncUrl();
    },
});
const resetBtn = document.getElementById('reset-btn');
const form = document.getElementById('choices-form');
const optionsCard = document.getElementById('options-card');
const optionsSelectHint = document.getElementById('options-select-hint');
const optionsTable = document.getElementById('options-table');
const optionsEmpty = document.getElementById('options-empty');

let data = null;
let settings = null;
let valuation = null;
let panel = null;
let choiceSources = {};
// Packages whose "Details" are open (kept across re-renders, e.g. a changed weekly spend).
const expandedKeys = new Set();

// Every selectable choice pool: choice items (chests), packages with their own `choice` block
// (e.g. Weekly Special) and groups of packages you can only buy one of (`exclusive_group`,
// e.g. calendar packs). Packages are keyed `package:<id>`, groups `group:<id>`, so they can't
// collide with an item id of the same name.
function collectChoiceSources(locale) {
    const result = {};
    for (const [itemId, item] of Object.entries(data.items)) {
        if (item.type === 'choice' && item.choice?.choices?.length) {
            result[itemId] = { name: item.name, category: item.category, choice: item.choice };
        }
    }
    const groups = new Map();
    for (const [pkgId, pkg] of Object.entries(data.packages)) {
        if (pkg.choice?.choices?.length) {
            result[`package:${pkgId}`] = {
                name: packageDisplayText(pkg, locale),
                category: pkg.category,
                choice: pkg.choice,
            };
        }
        if (pkg.exclusive_group && pkg.price > 0) {
            if (!groups.has(pkg.exclusive_group)) {
                groups.set(pkg.exclusive_group, []);
            }
            groups.get(pkg.exclusive_group).push(pkg);
        }
    }
    for (const [groupId, members] of groups) {
        result[`group:${groupId}`] = {
            name: t('choices.groupName', {
                packages: members.map((pkg) => packageDisplayText(pkg, locale)).join(' / '),
            }),
            category: members[0].category,
            packages: members,
        };
    }
    return result;
}

function renderSelectCountHint(selectCount, totalOptions) {
    optionsSelectHint.hidden = selectCount <= 1;
    optionsSelectHint.textContent =
        selectCount <= 1
            ? ''
            : selectCount >= totalOptions
              ? t('choices.selectCountHintAll', { total: totalOptions })
              : t('choices.selectCountHintPartial', { count: selectCount, total: totalOptions });
}

function render() {
    const source = choiceSources[itemPicker.getValue()];
    if (!source || !valuation) {
        optionsCard.hidden = true;
        return;
    }
    const locale = getLocale();
    optionsCard.hidden = false;
    if (source.packages) {
        renderGroup(source.packages, locale);
        return;
    }

    const rows = source.choice.choices
        .map((option) => {
            const b = valuation.bundle({ contains: option }, 0);
            const label = bundleLabel(option, data.items, locale);
            return {
                firstId: Object.keys(option)[0],
                label,
                points: b.points,
                worth: b.worth,
                incomplete: b.incomplete,
            };
        })
        .sort((a, b) => b.worth - a.worth);
    optionsEmpty.hidden = rows.length > 0;
    renderSelectCountHint(source.choice.select_count || 1, rows.length);

    const best = rows[0]?.worth || 0;
    const tieFlags = computeTieFlags(rows.map((row) => row.worth.toFixed(4)));
    optionsTable.innerHTML = `
        <thead>
            <tr>
                <th class="text-right table-col-rank">${t('choices.table.rank')}</th>
                <th>${t('choices.table.option')}</th>
                <th>${t('choices.table.category')}</th>
                <th class="text-right">${t('choices.table.points')}</th>
                <th class="text-right table-col-fit">${t('choices.table.worth')}</th>
                <th class="text-right">${t('choices.table.vsBest')}</th>
            </tr>
        </thead>
        <tbody>${rows
            .map(
                (row, index) => `
                <tr>
                    <td class="text-right table-col-rank">${tieFlags[index] ? '' : index + 1}</td>
                    <td><span class="item-cell">${itemIconSlot(row.firstId)}${row.label}${row.incomplete ? ` <span class="text-bad">${t('choices.incomplete')}</span>` : ''}</span></td>
                    <td>${enumLabel('category', data.items[row.firstId]?.category)}</td>
                    <td class="text-right">${formatSignificant(row.points)}</td>
                    <td class="text-right">${banknotesHtml(formatSignificant(row.worth))}</td>
                    <td class="text-right">${best > 0 ? ratioBarHtml(row.worth / best, 1, { label: `${formatThousands((100 * row.worth) / best, 1)}%` }) : t('common.notAvailable')}</td>
                </tr>`,
            )
            .join('')}</tbody>`;
    hydrateItemIcons(optionsTable);
}

/** A package's contents for its "Details": item × amount, points each and worth, most valuable first. */
function detailRowsHtml(row) {
    const key = escapeHtml(row.key);
    const hidden = expandedKeys.has(row.key) ? '' : 'hidden';
    const parts = breakdownParts(row.parts, data, valuation)
        .map(
            (part) => `
                <tr class="choice-details" data-details-key="${key}" ${hidden}>
                    <td></td>
                    <td><span class="item-cell">${part.item}</span></td>
                    <td class="text-right table-col-fit">${part.worthEach}</td>
                    <td class="text-right table-col-fit">${part.unknown ? `<span class="text-bad">${t('choices.incomplete')}</span>` : banknotesHtml(formatThousands(part.worth, 0))}</td>
                    <td></td>
                    <td></td>
                    <td class="table-col-fit"></td>
                </tr>`,
        )
        .join('');
    return `
        <tr class="choice-details choice-details--header" data-details-key="${key}" ${hidden}>
            <th></th>
            <th>${t('choices.table.item')}</th>
            <th class="text-right table-col-fit">${t('choices.table.worthEach')}</th>
            <th class="text-right table-col-fit">${t('choices.table.worth')}</th>
            <th></th>
            <th></th>
            <th class="table-col-fit"></th>
        </tr>
        ${parts}`;
}

/** "Buy only one of these packages": ranked by what each is worth beyond its price. */
function renderGroup(packages, locale) {
    const rows = packages
        .map((pkg, index) => {
            const b = valuation.bundle(pkg, pkg.price);
            return {
                pkg,
                key: `${itemPicker.getValue()}#${index}`,
                parts: b.parts || [],
                worth: b.worth,
                ratio: b.ratio,
                gain: b.worth - pkg.price,
                incomplete: b.incomplete,
            };
        })
        .sort((a, b) => b.gain - a.gain);
    optionsEmpty.hidden = rows.length > 0;
    optionsSelectHint.hidden = false;
    optionsSelectHint.textContent = t('choices.groupHint');
    const tieFlags = computeTieFlags(rows.map((row) => row.gain.toFixed(2)));
    const maxRatio = Math.max(1, ...rows.map((row) => row.ratio).filter(Number.isFinite));
    const gold = (value) => banknotesHtml(formatThousands(value, 0));
    optionsTable.innerHTML = `
        <thead>
            <tr>
                <th class="text-right table-col-rank">${t('choices.table.rank')}</th>
                <th>${t('choices.table.package')}</th>
                <th class="text-right table-col-fit table-col-num">${t('choices.table.price')}</th>
                <th class="text-right table-col-fit table-col-num">${t('choices.table.worth')}</th>
                <th class="text-right table-col-fit table-col-num">${t('choices.table.ratio')}</th>
                <th class="text-right table-col-fit table-col-num">${t('choices.table.gain')}</th>
                <th class="table-col-fit table-col-button"></th>
            </tr>
        </thead>
        <tbody>${rows
            .map(
                (row, index) => `
                <tr>
                    <td class="text-right table-col-rank">${tieFlags[index] ? '' : index + 1}</td>
                    <td>${packageDisplayName(row.pkg, locale)}${row.incomplete ? ` <span class="text-bad">${t('choices.incomplete')}</span>` : ''}</td>
                    <td class="text-right table-col-fit">${gold(row.pkg.price)}</td>
                    <td class="text-right table-col-fit">${gold(row.worth)}</td>
                    <td class="text-right table-col-fit">${ratioBarHtml(row.ratio, maxRatio)}</td>
                    <td class="text-right table-col-fit ${row.gain >= 0 ? 'text-good' : 'text-bad'}">${gold(row.gain)}</td>
                    <td class="text-right table-col-fit">${detailsToggleHtml(row.key, expandedKeys)}</td>
                </tr>
                ${detailRowsHtml(row)}`,
            )
            .join('')}</tbody>`;
    hydrateItemIcons(optionsTable);
    wireDetailsToggles(optionsTable, expandedKeys);
}

/** The chosen chest / package / group in the URL. */
function syncUrl() {
    setUrlParams({ item: itemPicker.getValue() });
}

async function recompute() {
    await withLoading(async () => {
        valuation = await buildValuation(data, settings);
        panel.showRate(valuation);
        render();
    });
}

async function init(loaded) {
    data = loaded;
    settings = getSettings();
    panel = mountValuationPanel(document.getElementById('valuation-panel'), data, { fields: ['budget'] });
    onSettingsChange((next) => {
        settings = next;
        recompute();
    });
    choiceSources = collectChoiceSources(getLocale());
    itemPicker.setItems(choiceSources);
    const itemParam = urlParam('item');
    if (itemParam && choiceSources[itemParam]) {
        itemPicker.setValue(itemParam);
    }

    form.addEventListener('submit', (event) => event.preventDefault());
    resetBtn.addEventListener('click', () => {
        itemPicker.reset(); // doesn't notify onChange
        render();
        syncUrl();
    });
    await recompute();
}

startPage('choices', {
    init,
    onLocaleChange() {
        choiceSources = collectChoiceSources(getLocale());
        itemPicker.setItems(choiceSources);
        render();
    },
});
