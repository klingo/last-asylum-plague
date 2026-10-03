import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { buildValuation, modelSummaryText } from './lib/valuation';
import { mountValuationPanel } from './lib/valuation-panel';
import { withLoading } from './lib/loading';
import { packageDisplayName, packageDisplayText, itemDisplayName } from './lib/labels';
import { createItemPicker } from './lib/item-picker';
import { createItemImage, banknoteIconHtml } from './lib/images';
import { formatThousands, formatSignificant, computeTieFlags } from './lib/format';
import { ratioBarHtml } from './lib/ratio-bar';
import { t, getLocale, categoryLabel, applyStaticTranslations } from './lib/i18n';

renderNav('choices');
applyStaticTranslations();

const itemPicker = createItemPicker({
    input: document.getElementById('item-search'),
    panel: document.getElementById('item-listbox'),
    clearButton: document.getElementById('item-search-clear'),
    onChange: () => {
        render();
        syncUrl();
    },
});
const resetBtn = document.getElementById('reset-btn');
const form = document.getElementById('choices-form');
const optionsCard = document.getElementById('options-card');
const optionsSelectHint = document.getElementById('options-select-hint');
const optionsMeta = document.getElementById('options-meta');
const optionsTable = document.getElementById('options-table');
const optionsEmpty = document.getElementById('options-empty');

let data = null;
let settings = null;
let valuation = null;
let choiceSources = {};

// Every selectable choice pool: choice items (chests), packages with their own `choice` block
// (e.g. Jokers Weekly Special) and groups of packages you can only buy one of (`exclusive_group`,
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
    optionsMeta.textContent = modelSummaryText(valuation);
    if (source.packages) {
        renderGroup(source.packages, locale);
        return;
    }

    const rows = source.choice.choices
        .map((option) => {
            const b = valuation.bundle({ contains: option }, 0);
            const label = Object.entries(option)
                .map(([id, qty]) => `${itemDisplayName(data.items, id, locale)} &times;${formatThousands(qty)}`)
                .join(' + ');
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
                <th class="text-right">${t('choices.table.worth')}</th>
                <th class="text-right">${t('choices.table.vsBest')}</th>
            </tr>
        </thead>
        <tbody>${rows
            .map(
                (row, index) => `
                <tr>
                    <td class="text-right table-col-rank">${tieFlags[index] ? '' : index + 1}</td>
                    <td><span class="item-cell"><span data-item-id="${row.firstId}"></span>${row.label}${row.incomplete ? ` <span class="text-bad">${t('choices.incomplete')}</span>` : ''}</span></td>
                    <td>${categoryLabel(data.items[row.firstId]?.category)}</td>
                    <td class="text-right">${formatSignificant(row.points)}</td>
                    <td class="text-right"><span class="text-gold">${formatSignificant(row.worth)}</span> ${banknoteIconHtml()}</td>
                    <td class="text-right">${best > 0 ? ratioBarHtml(row.worth / best, 1, { label: `${formatThousands((100 * row.worth) / best, 1)}%` }) : t('common.notAvailable')}</td>
                </tr>`,
            )
            .join('')}</tbody>`;
    optionsTable.querySelectorAll('[data-item-id]').forEach((placeholder) => {
        const itemId = placeholder.getAttribute('data-item-id');
        placeholder.replaceWith(createItemImage(itemId, itemId, 'item-icon item-icon--sm'));
    });
}

/** "Buy only one of these packages": ranked by what each is worth beyond its price. */
function renderGroup(packages, locale) {
    const rows = packages
        .map((pkg) => {
            const b = valuation.bundle(pkg, pkg.price);
            return { pkg, worth: b.worth, ratio: b.ratio, gain: b.worth - pkg.price, incomplete: b.incomplete };
        })
        .sort((a, b) => b.gain - a.gain);
    optionsEmpty.hidden = rows.length > 0;
    optionsSelectHint.hidden = false;
    optionsSelectHint.textContent = t('choices.groupHint');
    const tieFlags = computeTieFlags(rows.map((row) => row.gain.toFixed(2)));
    const maxRatio = Math.max(1, ...rows.map((row) => row.ratio).filter(Number.isFinite));
    const gold = (value) => `<span class="text-gold">${formatThousands(value, 0)}</span> ${banknoteIconHtml()}`;
    optionsTable.innerHTML = `
        <thead>
            <tr>
                <th class="text-right table-col-rank">${t('choices.table.rank')}</th>
                <th>${t('choices.table.package')}</th>
                <th class="text-right">${t('choices.table.price')}</th>
                <th class="text-right">${t('choices.table.worth')}</th>
                <th class="text-right">${t('choices.table.ratio')}</th>
                <th class="text-right">${t('choices.table.gain')}</th>
            </tr>
        </thead>
        <tbody>${rows
            .map(
                (row, index) => `
                <tr>
                    <td class="text-right table-col-rank">${tieFlags[index] ? '' : index + 1}</td>
                    <td>${packageDisplayName(row.pkg, locale)}${row.incomplete ? ` <span class="text-bad">${t('choices.incomplete')}</span>` : ''}</td>
                    <td class="text-right">${gold(row.pkg.price)}</td>
                    <td class="text-right">${gold(row.worth)}</td>
                    <td class="text-right">${ratioBarHtml(row.ratio, maxRatio)}</td>
                    <td class="text-right ${row.gain >= 0 ? 'text-good' : 'text-bad'}">${gold(row.gain)}</td>
                </tr>`,
            )
            .join('')}</tbody>`;
}

function syncUrl() {
    const url = new URL(window.location.href);
    const params = new URLSearchParams();
    const lang = url.searchParams.get('lang');
    if (lang) {
        params.set('lang', lang);
    }
    if (itemPicker.getValue()) {
        params.set('item', itemPicker.getValue());
    }
    window.history.replaceState(null, '', `${url.pathname}${params.size ? `?${params}` : ''}${url.hash}`);
}

async function recompute() {
    await withLoading(async () => {
        valuation = await buildValuation(data, settings);
        render();
    });
}

async function init() {
    data = await loadPackData();
    const panel = mountValuationPanel(document.getElementById('valuation-panel'), data, {
        fields: ['budget'],
        onChange: (next) => {
            settings = next;
            recompute();
        },
    });
    settings = panel.getSettings();
    choiceSources = collectChoiceSources(getLocale());
    itemPicker.setItems(choiceSources);
    const itemParam = new URLSearchParams(window.location.search).get('item');
    if (itemParam && choiceSources[itemParam]) {
        itemPicker.setValue(itemParam);
    }

    form.addEventListener('submit', (event) => event.preventDefault());
    resetBtn.addEventListener('click', () => {
        itemPicker.reset(); // doesn't notify onChange
        render();
        syncUrl();
    });
    window.addEventListener('localechange', () => {
        applyStaticTranslations();
        choiceSources = collectChoiceSources(getLocale());
        itemPicker.setItems(choiceSources);
        render();
    });
    await recompute();
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
