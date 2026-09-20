import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { createMarket, collectPackageSources, collectExchangeSources, packageDisplayName } from './lib/pricing-core';
import { createItemPicker } from './lib/item-picker';
import { createMultiSelect } from './lib/multi-select';
import { createItemImage, banknoteIconHtml } from './lib/images';
import { formatUnitPriceColumn, formatThousands, computeTieFlags } from './lib/format';
import {
    t,
    getLocale,
    localizedName,
    categoryLabel,
    sourceTypeLabel,
    formatDays,
    applyStaticTranslations,
} from './lib/i18n';

renderNav('choices');
applyStaticTranslations();

const itemSearchInput = document.getElementById('item-search');
const itemListPanel = document.getElementById('item-listbox');
const itemSearchClearBtn = document.getElementById('item-search-clear');
const itemPicker = createItemPicker({
    input: itemSearchInput,
    panel: itemListPanel,
    clearButton: itemSearchClearBtn,
    onChange: () => recalculate(),
});
const eventSelectButton = document.getElementById('event-select-button');
const eventSelectPanel = document.getElementById('event-select-panel');
const eventMultiSelect = createMultiSelect({
    button: eventSelectButton,
    panel: eventSelectPanel,
    emptyLabel: () => t('analyze.eventsNoneSelected'),
    countLabel: (count) => t('analyze.eventsSelectedCount', { count }),
    onChange: () => recalculate(),
});
const resetBtn = document.getElementById('reset-btn');
const form = document.getElementById('choices-form');

const optionsCard = document.getElementById('options-card');
const optionsSelectHint = document.getElementById('options-select-hint');
const optionsTable = document.getElementById('options-table');
const optionsEmpty = document.getElementById('options-empty');
const appFooter = document.querySelector('.app-footer');

let data = null;
let choiceSources = {};

// Every selectable "choice pool" on this page: items with `type: "choice"` (chests/resource
// pouches) AND packages that carry their own `choice` block directly (e.g. "Jokers Weekly
// Special" lets you pick N of its listed rewards on top of its fixed contents). Both shapes
// store the same `{ select_count, choices }` structure, so downstream code only ever needs
// `.choice`.
//
// Package-derived entries are keyed with a `package:` prefix (items are kept bare) because a
// package id can otherwise collide with an unrelated item id (e.g. "raven_essence" and
// "study_scroll" each name both an item and a package in pack_data.json today) — the prefix
// keeps the two namespaces apart without touching lib/item-picker.js, which already tolerates
// keys that don't resolve to a real item icon (falls back to no icon at all, same as any other
// item with a still-missing image).
function collectChoiceSources(items, packages, locale) {
    const result = {};
    for (const [itemId, item] of Object.entries(items)) {
        if (item.type === 'choice' && item.choice?.choices?.length) {
            result[itemId] = { name: item.name, category: item.category, choice: item.choice };
        }
    }
    for (const [pkgId, pkg] of Object.entries(packages)) {
        if (pkg.choice?.choices?.length) {
            result[`package:${pkgId}`] = {
                name: packageDisplayName(pkg, locale),
                category: pkg.category,
                choice: pkg.choice,
                // Its own price/yield must never count as evidence for its own contents'
                // worth — see buildOptionRows.
                excludePackageId: pkgId,
            };
        }
    }
    return result;
}

// Every "choice" entry in pack_data.json hands over exactly one item type per option
// (`{ itemId: qty }`), so only that single pair is used here.
function firstEntry(choiceEntry) {
    return Object.entries(choiceEntry)[0] || [null, 0];
}

function populateEventSelect(events) {
    const sortedEvents = Object.entries(events).sort((a, b) =>
        localizedName(a[1].name).localeCompare(localizedName(b[1].name)),
    );
    eventMultiSelect.setOptions(
        sortedEvents.map(([eventId, event]) => ({ id: eventId, label: localizedName(event.name) })),
    );
}

/**
 * Values every option of `choiceItem` by the cheapest known Banknotes cost to buy that same
 * item/quantity elsewhere (the same "cheapest unit cost" approach lib/ranking-core.js uses to
 * value a package's own "choice" contents), then finds the single best-priced source for each
 * option so the table below can show its Type/Source/Days.
 *
 * `activeEventIds` mirrors the Analyze page's "Active Events" selection: each selected id gates
 * any package/exchange shop tied to that event via `event_id` the same way
 * lib/pricing-core.js's `createMarket` does for Analyze (an empty set means no event is active).
 * A shop counts as active exactly when its own event is selected, which in turn restricts which
 * shop may sell an option's item *directly*; currency needed for an exchange offer can still
 * come from any shop, matching `market.purchase()`'s own shopFilter semantics.
 *
 * When `choiceSource` is itself a package (`excludePackageId` set), that package is dropped from
 * the pricing market entirely: otherwise it counts as a valid (and often the cheapest) source
 * for its own choice contents, so every option would price out identically to the package's own
 * price/yield ratio instead of reflecting what it'd cost through some OTHER purchase option —
 * the same self-reference lib/ranking-core.js's `marketExcludingPackage` guards against.
 */
function buildOptionRows(choiceSource, items, packages, exchangeShops, locale, activeEventIds) {
    const pricingPackages = choiceSource.excludePackageId
        ? Object.fromEntries(Object.entries(packages).filter(([id]) => id !== choiceSource.excludePackageId))
        : packages;
    const market = createMarket(pricingPackages, exchangeShops, items, {}, { activeEventIds }, locale);

    const activeShops = {};
    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        if (shop.event_id && activeEventIds.has(shop.event_id)) {
            activeShops[shopId] = shop;
        }
    }
    const activeShopIds = new Set(Object.keys(activeShops));

    return choiceSource.choice.choices.map((choiceEntry) => {
        const [itemId, qty] = firstEntry(choiceEntry);
        const unitCost = itemId ? market.peekUnitCost(itemId, activeShopIds) : NaN;
        const totalValue = Number.isFinite(unitCost) ? qty * unitCost : NaN;

        const packageSources = itemId
            ? collectPackageSources(itemId, pricingPackages, items, {}, locale, activeEventIds, false)
            : [];
        const exchangeSources = itemId
            ? collectExchangeSources(itemId, activeShops, items, market.peekUnitCost, {}, locale, activeEventIds, false)
            : [];
        const bestSource = [...packageSources, ...exchangeSources]
            .filter((s) => Number.isFinite(s.pricePerUnit))
            .reduce((best, s) => (!best || s.pricePerUnit < best.pricePerUnit ? s : best), null);

        return { itemId, qty, unitCost, totalValue, bestSource };
    });
}

// Most choice items only ever let you pick 1 of their options, which the page's static
// description already covers ("that's the option worth picking"). Packages like "Jokers
// Weekly Special" pick more than one (or even all) of theirs, which changes what "ranked"
// means in practice, so that case gets an explicit hint instead.
function renderSelectCountHint(selectCount, totalOptions) {
    if (selectCount <= 1 || totalOptions === 0) {
        optionsSelectHint.hidden = true;
        optionsSelectHint.textContent = '';
        return;
    }
    optionsSelectHint.hidden = false;
    optionsSelectHint.textContent =
        selectCount >= totalOptions
            ? t('choices.selectCountHintAll', { total: totalOptions })
            : t('choices.selectCountHintPartial', { count: selectCount, total: totalOptions });
}

function renderOptionsTable(rows, items, locale) {
    // Ranked by highest per-unit price first: that's the option whose reward would cost the
    // most per unit to buy through any other purchase source, i.e. the best pick from the
    // choice. Options with no known source at all sort to the bottom rather than being
    // dropped, so every option a choice item offers is still visible.
    const ordered = [...rows].sort((a, b) => {
        const av = Number.isFinite(a.unitCost) ? a.unitCost : -Infinity;
        const bv = Number.isFinite(b.unitCost) ? b.unitCost : -Infinity;
        return bv - av;
    });
    // Same shared-precision "/ Unit" column treatment as the Analyze page's Purchase Sources
    // table (see lib/format.js `formatUnitPriceColumn`).
    const perUnitDisplay = formatUnitPriceColumn(ordered.map((row) => row.unitCost));
    // Competition ranking against the same displayed "/ Unit" value the table sorts by (see
    // rankings.js for the equivalent on the Value Ranking page): ties share a rank, with every
    // entry after the first in a tied run left blank instead of repeating the number.
    const tieFlags = computeTieFlags(perUnitDisplay);

    const rowsHtml = ordered
        .map((row, index) => {
            const rank = tieFlags[index] ? '' : index + 1;
            const item = items[row.itemId];
            const category = categoryLabel(item?.category);
            const priceCell = Number.isFinite(row.totalValue)
                ? `<span class="text-gold">${formatThousands(row.totalValue, 2)}</span> ${banknoteIconHtml()}`
                : t('common.notAvailable');
            const perUnitCell =
                perUnitDisplay[index] !== null
                    ? `<span class="text-gold">${perUnitDisplay[index]}</span> ${banknoteIconHtml()}`
                    : t('common.notAvailable');
            const pillClass = row.bestSource
                ? row.bestSource.type === 'exchange'
                    ? 'pill--exchange_offer'
                    : `pill--${row.bestSource.type}`
                : '';
            const typeCell = row.bestSource
                ? `<span class="pill ${pillClass}">${sourceTypeLabel(row.bestSource.type)}</span>`
                : t('common.notAvailable');
            const sourceCell = row.bestSource ? row.bestSource.name : t('common.notAvailable');
            const daysCell = row.bestSource ? formatDays(row.bestSource.availableDays) : t('common.notAvailable');

            return `
                <tr>
                    <td class="text-right table-col-rank">${rank}</td>
                    <td><span class="item-cell" data-item-id="${row.itemId}"></span></td>
                    <td>${typeCell}</td>
                    <td>${sourceCell}</td>
                    <td>${category}</td>
                    <td>${daysCell}</td>
                    <td class="text-right">${priceCell}</td>
                    <td class="text-right">${formatThousands(row.qty)}</td>
                    <td class="text-right">${perUnitCell}</td>
                </tr>
            `;
        })
        .join('');

    optionsTable.innerHTML = `
        <thead>
            <tr>
                <th class="text-right table-col-rank">${t('rankings.table.rank')}</th>
                <th>${t('choices.table.item')}</th>
                <th>${t('analyze.table.type')}</th>
                <th>${t('analyze.table.source')}</th>
                <th>${t('analyze.table.category')}</th>
                <th>${t('analyze.table.days')}</th>
                <th class="text-right">${t('analyze.table.pricePerPurchase')}</th>
                <th class="text-right">${t('analyze.table.yieldPerPurchase')}</th>
                <th class="text-right">${t('analyze.table.perUnit', { icon: banknoteIconHtml() })}</th>
            </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
    `;

    // Populate the item icon + name (a real DOM node, can't be inlined into the HTML string
    // above), matching the same placeholder pattern main.js's Purchase Plan table and
    // rankings.js's breakdown rows use.
    optionsTable.querySelectorAll('[data-item-id]').forEach((cell) => {
        const itemId = cell.getAttribute('data-item-id');
        const item = items[itemId];
        const name = localizedName(item?.name, locale) || itemId || t('common.unknown');
        const img = createItemImage(itemId, name, 'item-icon item-icon--sm');
        cell.appendChild(img);
        cell.appendChild(document.createTextNode(name));
    });
}

function syncUrlParams() {
    const url = new URL(window.location.href);
    const params = new URLSearchParams();
    const itemId = itemPicker.getValue();
    const eventIds = [...eventMultiSelect.getValues()];
    const lang = new URLSearchParams(url.search).get('lang');

    if (lang) {
        params.set('lang', lang);
    }
    if (itemId) {
        params.set('item', itemId);
    }
    if (eventIds.length > 0) {
        params.set('events', eventIds.join(','));
    }

    const queryString = params.toString();
    const newUrl = `${url.pathname}${queryString ? `?${queryString}` : ''}${url.hash}`;
    window.history.replaceState(null, '', newUrl);
}

function applyUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const itemParam = params.get('item');
    const eventsParam = params.get('events');
    if (itemParam && choiceSources[itemParam]) {
        itemPicker.setValue(itemParam);
    }
    const eventIds = eventsParam ? eventsParam.split(',').filter((id) => data?.events?.[id]) : [];
    eventMultiSelect.setValues(eventIds);
}

function recalculate({ syncUrl = true } = {}) {
    if (!data) {
        return;
    }

    if (syncUrl) {
        syncUrlParams();
    }

    const targetKey = itemPicker.getValue();
    const source = choiceSources[targetKey];
    if (!source) {
        optionsCard.hidden = true;
        return;
    }

    const { items, packages = {}, exchange_shops: exchangeShops = {} } = data;
    const locale = getLocale();
    const activeEventIds = eventMultiSelect.getValues();
    const rows = buildOptionRows(source, items, packages, exchangeShops, locale, activeEventIds);

    optionsCard.hidden = false;
    if (rows.length === 0) {
        optionsTable.innerHTML = '';
        optionsEmpty.hidden = false;
        renderSelectCountHint(0, 0);
        return;
    }
    optionsEmpty.hidden = true;
    renderSelectCountHint(source.choice.select_count || 1, rows.length);
    renderOptionsTable(rows, items, locale);
}

function handleReset() {
    itemPicker.reset();
    eventMultiSelect.reset();
    const url = new URL(window.location.href);
    const lang = new URLSearchParams(url.search).get('lang');
    window.history.replaceState(null, '', `${url.pathname}${lang ? `?lang=${lang}` : ''}${url.hash}`);
    recalculate({ syncUrl: false });
}

function updateFooter() {
    if (!appFooter) {
        return;
    }
    appFooter.textContent = data?.metadata?.last_updated
        ? t('footer.choicesGenerated', { date: data.metadata.last_updated })
        : t('footer.choicesDefault');
}

async function init() {
    data = await loadPackData();
    updateFooter();
    choiceSources = collectChoiceSources(data.items || {}, data.packages || {}, getLocale());
    itemPicker.setItems(choiceSources);
    populateEventSelect(data.events || {});
    applyUrlParams();

    window.addEventListener('localechange', () => {
        const selectedEventIds = [...eventMultiSelect.getValues()];
        applyStaticTranslations();
        updateFooter();
        // Rebuilt (not just re-affirmed) because package-derived entries' display names are
        // pre-resolved strings (see collectChoiceSources), unlike items' raw {en,de} name
        // objects which lib/item-picker.js re-resolves to the new locale on its own. setItems()
        // keeps the current selection as long as its key still exists, same as before.
        choiceSources = collectChoiceSources(data.items || {}, data.packages || {}, getLocale());
        itemPicker.setItems(choiceSources);
        populateEventSelect(data.events || {});
        eventMultiSelect.setValues(selectedEventIds);
        recalculate({ syncUrl: false });
    });

    if (resetBtn) {
        resetBtn.addEventListener('click', handleReset);
    }
    if (form) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            recalculate();
        });
    }
    window.addEventListener('popstate', () => {
        applyUrlParams();
        recalculate({ syncUrl: false });
    });

    recalculate({ syncUrl: false });
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
