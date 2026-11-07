/**
 * Best Pick: the options of a choice chest, of a package with options, or of a group of packages you can only buy one
 * of (`exclusive_group`, e.g. calendar packs), ranked by worth. The pick is in the URL (`?item=`).
 */
import { startPage } from '../ui/page.js';
import '../styles/pages/choices.css';
import { urlParam, setUrlParams } from '../ui/url.js';
import { mountValuationPage } from '../ui/valuation-page.js';
import { selectCount } from '../core/items.js';
import { packageDisplayName, packageDisplayText, bundleLabel } from '../ui/labels.js';
import { createItemPicker } from '../ui/item-picker.js';
import { banknotesAmount, banknotesHtml, escapeHtml, itemIconSlot, hydrateItemIcons } from '../ui/html.js';
import { detailsToggleHtml, wireDetailsToggles, breakdownParts } from '../ui/grid.js';
import { formatSignificant, formatPercent, computeTieFlags } from '../ui/format.js';
import { ratioBarHtml, ratioScale } from '../ui/ratio-bar.js';
import { t, getLocale, enumLabel, tHtml } from '../ui/i18n.js';

const resetBtn = document.getElementById('reset-btn');
const form = document.getElementById('choices-form');
const optionsCard = document.getElementById('options-card');
const optionsSelectHint = document.getElementById('options-select-hint');
const optionsTable = document.getElementById('options-table');
const optionsEmpty = document.getElementById('options-empty');

let data = null;
let itemPicker = null;
let valuation = null;
let recompute = null;
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
    renderSelectCountHint(selectCount(source.choice), rows.length);

    const best = rows[0]?.worth || 0;
    const tieFlags = computeTieFlags(rows.map((row) => row.worth.toFixed(4)));
    optionsTable.innerHTML = `
        <thead>
            <tr>
                <th class="text-right table-col-rank">${tHtml('common.table.rank')}</th>
                <th>${tHtml('choices.table.option')}</th>
                <th class="table-col-wide">${tHtml('common.table.category')}</th>
                <th class="text-right table-col-wide">${tHtml('choices.table.points')}</th>
                <th class="text-right table-col-fit">${tHtml('common.table.worth')}</th>
                <th class="text-right">${tHtml('choices.table.vsBest')}</th>
            </tr>
        </thead>
        <tbody>${rows
            .map(
                (row, index) => `
                <tr>
                    <td class="text-right table-col-rank">${tieFlags[index] ? '' : index + 1}</td>
                    <td><span class="item-cell">${itemIconSlot(row.firstId)}${row.label}${row.incomplete ? ` <span class="text-bad">${tHtml('choices.incomplete')}</span>` : ''}</span></td>
                    <td class="table-col-wide">${enumLabel('category', data.items[row.firstId]?.category)}</td>
                    <td class="text-right table-col-wide">${formatSignificant(row.points)}</td>
                    <td class="text-right table-col-fit">${banknotesHtml(formatSignificant(row.worth))}</td>
                    <td class="text-right">${best > 0 ? ratioBarHtml(row.worth / best, 1, { label: formatPercent(row.worth / best) }) : tHtml('common.notAvailable')}</td>
                </tr>`,
            )
            .join('')}</tbody>`;
    hydrateItemIcons(optionsTable);
}

/** A package's contents for its "Details": item × amount, points each and worth, most valuable first. */
function detailRowsHtml(row) {
    const key = escapeHtml(row.key);
    const hidden = expandedKeys.has(row.key) ? '' : 'hidden';
    // The Worth and Ratio columns are hidden on phones: the item's worth moves to the (otherwise empty) Gain column.
    const parts = breakdownParts(row.parts, data, valuation)
        .map((part) => {
            const worth = part.unknown ? `<span class="text-bad">${tHtml('choices.incomplete')}</span>` : part.worth;
            return `
                <tr class="choice-details" data-details-key="${key}" ${hidden}>
                    <td></td>
                    <td><span class="item-cell">${part.item}</span></td>
                    <td class="text-right table-col-fit">${part.worthEach}</td>
                    <td class="text-right table-col-fit table-col-wide">${worth}</td>
                    <td class="table-col-wide"></td>
                    <td class="text-right table-col-fit"><span class="phone-only">${worth}</span></td>
                    <td class="table-col-fit"></td>
                </tr>`;
        })
        .join('');
    return `
        <tr class="choice-details choice-details--header" data-details-key="${key}" ${hidden}>
            <th></th>
            <th>${tHtml('common.table.item')}</th>
            <th class="text-right table-col-fit">${tHtml('common.table.worthEach')}</th>
            <th class="text-right table-col-fit table-col-wide">${tHtml('common.table.worth')}</th>
            <th class="table-col-wide"></th>
            <th class="text-right table-col-fit"><span class="phone-only">${tHtml('common.table.worth')}</span></th>
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
    const maxRatio = ratioScale(rows.map((row) => row.ratio));
    optionsTable.innerHTML = `
        <thead>
            <tr>
                <th class="text-right table-col-rank">${tHtml('common.table.rank')}</th>
                <th>${tHtml('choices.table.package')}</th>
                <th class="text-right table-col-fit table-col-num">${tHtml('common.table.price')}</th>
                <th class="text-right table-col-fit table-col-num table-col-wide">${tHtml('common.table.worth')}</th>
                <th class="text-right table-col-fit table-col-num table-col-wide">${tHtml('common.table.ratio')}</th>
                <th class="text-right table-col-fit table-col-num">${tHtml('choices.table.gain')}</th>
                <th class="table-col-fit table-col-button"></th>
            </tr>
        </thead>
        <tbody>${rows
            .map(
                (row, index) => `
                <tr>
                    <td class="text-right table-col-rank">${tieFlags[index] ? '' : index + 1}</td>
                    <td>${packageDisplayName(row.pkg, locale)}${row.incomplete ? ` <span class="text-bad">${tHtml('choices.incomplete')}</span>` : ''}</td>
                    <td class="text-right table-col-fit">${banknotesAmount(row.pkg.price)}</td>
                    <td class="text-right table-col-fit table-col-wide">${banknotesAmount(row.worth)}</td>
                    <td class="text-right table-col-fit table-col-wide">${ratioBarHtml(row.ratio, maxRatio)}</td>
                    <td class="text-right table-col-fit ${row.gain >= 0 ? 'text-good' : 'text-bad'}">${banknotesAmount(row.gain)}</td>
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

async function init(loaded) {
    data = loaded;
    itemPicker = createItemPicker({
        trigger: document.getElementById('item-search'),
        placeholderKey: 'choices.itemPlaceholder',
        onChange: () => {
            render();
            syncUrl();
        },
    });
    ({ recompute } = mountValuationPage(data, {
        fields: ['budget'],
        render: (next) => {
            valuation = next;
            render();
        },
    }));
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
