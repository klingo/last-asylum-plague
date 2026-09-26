import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { createMarket, collectPackageSources, collectExchangeSources, buildItemCostResolver } from './lib/pricing-core';
import { buildPurchasePlan } from './lib/purchase-plan';
import { createFairValueMarket } from './lib/ranking-core';
import { createItemImage, banknoteIconHtml } from './lib/images';
import { createItemPicker } from './lib/item-picker';
import { createMultiSelect } from './lib/multi-select';
import { enableInfoTooltips } from './lib/tooltip';
import { requiresIconHtml } from './lib/requires-tooltip';
import { formatUnitPriceColumn, formatThousands } from './lib/format';
import { t, getLocale, localizedName, categoryLabel, sourceTypeLabel, applyStaticTranslations } from './lib/i18n';

renderNav('compare');
applyStaticTranslations();

const itemPickerA = createItemPicker({
    input: document.getElementById('item-search-a'),
    panel: document.getElementById('item-listbox-a'),
    clearButton: document.getElementById('item-search-clear-a'),
    onChange: () => recalculate(),
});
const itemPickerB = createItemPicker({
    input: document.getElementById('item-search-b'),
    panel: document.getElementById('item-listbox-b'),
    clearButton: document.getElementById('item-search-clear-b'),
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
const daysInput = document.getElementById('days-input');
const exceedPackLimitsCheckbox = document.getElementById('exceed-pack-limits-checkbox');
const resetBtn = document.getElementById('reset-btn');
const form = document.getElementById('compare-form');

const valueCard = document.getElementById('value-card');
const valuePrompt = document.getElementById('value-prompt');
const valueContent = document.getElementById('value-content');
const compareBar = document.getElementById('compare-bar');
const compareSummary = document.getElementById('compare-summary');
const compareUnknownNote = document.getElementById('compare-unknown-note');

const costCard = document.getElementById('cost-card');
const planCard = document.getElementById('plan-card');
const appFooter = document.querySelector('.app-footer');

const sides = {
    a: {
        picker: itemPickerA,
        quantityInput: document.getElementById('quantity-input-a'),
        prompt: document.getElementById('side-prompt-a'),
        content: document.getElementById('side-content-a'),
        sourcesHeading: document.getElementById('sources-heading-a'),
        sourcesTable: document.getElementById('sources-table-a'),
        sourcesEmpty: document.getElementById('sources-empty-a'),
        planPrompt: document.getElementById('plan-prompt-a'),
        planContent: document.getElementById('plan-content-a'),
        planHeading: document.getElementById('plan-heading-a'),
        planTable: document.getElementById('plan-table-a'),
        planSummary: document.getElementById('plan-summary-a'),
        planWarning: document.getElementById('plan-warning-a'),
    },
    b: {
        picker: itemPickerB,
        quantityInput: document.getElementById('quantity-input-b'),
        prompt: document.getElementById('side-prompt-b'),
        content: document.getElementById('side-content-b'),
        sourcesHeading: document.getElementById('sources-heading-b'),
        sourcesTable: document.getElementById('sources-table-b'),
        sourcesEmpty: document.getElementById('sources-empty-b'),
        planPrompt: document.getElementById('plan-prompt-b'),
        planContent: document.getElementById('plan-content-b'),
        planHeading: document.getElementById('plan-heading-b'),
        planTable: document.getElementById('plan-table-b'),
        planSummary: document.getElementById('plan-summary-b'),
        planWarning: document.getElementById('plan-warning-b'),
    },
};

let data = null;
// The bundle-aware "fair" per-item pricing (see lib/ranking-core.js) is independent of the
// events/days/exceed-limits controls below (rankings.html has none of those either), and is
// comparatively expensive to (re)build, so it's only rebuilt when the underlying data or
// locale actually changes, not on every recalculate().
let fairMarket = null;
// Fallback for items the fair-pricing solve couldn't settle (see lib/ranking-core.js's
// buildFairPriceMap header — plenty of items never reach "exactly one unsettled item" in any
// bundle): the same "cheapest known source" market pricing-core.js's own Sources table uses,
// so the value comparison still shows a number instead of just "unknown". Locale-independent
// (plain Banknotes costs, no display strings), so it only needs rebuilding when data changes.
let fallbackCostResolver = null;

function effectiveQuantity(input) {
    const value = Number(input ? input.value : 0);
    return value > 0 ? value : 1;
}

function populateEventSelect(events) {
    const sortedEvents = Object.entries(events).sort((a, b) =>
        localizedName(a[1].name).localeCompare(localizedName(b[1].name)),
    );
    eventMultiSelect.setOptions(
        sortedEvents.map(([eventId, event]) => ({ id: eventId, label: localizedName(event.name) })),
    );
}

function renderSourcesTable(tableEl, sources) {
    const ordered = [...sources].sort((a, b) => a.pricePerUnit - b.pricePerUnit);
    const perUnitDisplay = formatUnitPriceColumn(ordered.map((source) => source.pricePerUnit));

    const rows = ordered
        .map((source, index) => {
            const priceCell =
                source.type === 'exchange'
                    ? source.priceDisplay
                    : `<span class="text-gold">${formatThousands(source.price)}</span> ${banknoteIconHtml()}`;
            const pillClass = source.type === 'exchange' ? 'pill--exchange_offer' : `pill--${source.type}`;
            const typeLabel = sourceTypeLabel(source.type);
            const pricePerUnitCell =
                perUnitDisplay[index] !== null
                    ? `<span class="text-gold">${perUnitDisplay[index]}</span> ${banknoteIconHtml()}`
                    : t('common.notAvailable');

            return `
                <tr>
                    <td><span class="pill ${pillClass}">${typeLabel}</span></td>
                    <td>${source.name}${requiresIconHtml(source.requires, data?.packages || {}, data?.items || {}, getLocale())}</td>
                    <td>${categoryLabel(source.category)}</td>
                    <td class="text-right">${priceCell}</td>
                    <td class="text-right">${pricePerUnitCell}</td>
                </tr>
            `;
        })
        .join('');

    tableEl.innerHTML = `
        <thead>
            <tr>
                <th>${t('analyze.table.type')}</th>
                <th>${t('analyze.table.source')}</th>
                <th>${t('analyze.table.category')}</th>
                <th class="text-right">${t('analyze.table.pricePerPurchase')}</th>
                <th class="text-right">${t('analyze.table.perUnit', { icon: banknoteIconHtml() })}</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    `;
    enableInfoTooltips(tableEl);
}

function detailsRowsHtml(details) {
    return details
        .map(
            (detail) => `
                <div class="plan-grid__row">
                    <div class="plan-grid__cell">${detail.source.name}</div>
                    <div class="plan-grid__cell">${categoryLabel(detail.source.category)}</div>
                    <div class="plan-grid__cell text-right">${detail.purchases}</div>
                    <div class="plan-grid__cell text-right">${formatThousands(detail.unitsGained)}</div>
                    <div class="plan-grid__cell text-right"><span class="text-gold">${formatThousands(detail.cost)}</span> ${banknoteIconHtml()}</div>
                </div>
            `,
        )
        .join('');
}

function renderPlanTable(side, result, targetItemId) {
    const { planTable, planSummary, planWarning } = side;

    if (result.plan.length === 0) {
        planTable.innerHTML = '';
        planSummary.textContent = t('analyze.planEmpty');
        planWarning.hidden = true;
        planWarning.textContent = '';
        return;
    }

    const perUnitDisplay = formatUnitPriceColumn(result.plan.map(({ source }) => source.pricePerUnit));

    const rows = result.plan
        .map(({ source, purchases, unitsGained, cost, details }, index) => {
            const hasDetails = source.type === 'exchange' && details && details.length > 0;
            const detailsCell = hasDetails
                ? `<button type="button" class="expand-toggle" data-plan-index="${index}">${t('common.details')}</button>`
                : '';

            const detailsSection = hasDetails
                ? `
                <div class="plan-grid__details" data-plan-details="${index}" hidden>
                    <p class="plan-grid__details-intro">
                        ${t('analyze.detailsIntro', { currency: source.name.split(' - ')[1] || t('analyze.detailsIntroFallback') })}
                    </p>
                    <div class="plan-grid__row">
                        <div class="plan-grid__cell plan-grid__cell--header">${t('analyze.table.source')}</div>
                        <div class="plan-grid__cell plan-grid__cell--header">${t('analyze.table.category')}</div>
                        <div class="plan-grid__cell plan-grid__cell--header text-right">${t('analyze.table.purchases')}</div>
                        <div class="plan-grid__cell plan-grid__cell--header text-right">${t('analyze.table.unitsGained')}</div>
                        <div class="plan-grid__cell plan-grid__cell--header text-right">${t('analyze.table.cost', { icon: banknoteIconHtml() })}</div>
                    </div>
                    ${detailsRowsHtml(details)}
                </div>
            `
                : '';

            return `
                <div class="plan-grid__row" role="row">
                    <div class="plan-grid__cell item-cell" role="cell"></div>
                    <div class="plan-grid__cell" role="cell">${categoryLabel(source.category)}</div>
                    <div class="plan-grid__cell text-right" role="cell">${purchases}</div>
                    <div class="plan-grid__cell text-right" role="cell">${formatThousands(unitsGained)}</div>
                    <div class="plan-grid__cell text-right" role="cell"><span class="text-gold">${formatThousands(cost)}</span> ${banknoteIconHtml()}</div>
                    <div class="plan-grid__cell text-right" role="cell">${perUnitDisplay[index] !== null ? `<span class="text-gold">${perUnitDisplay[index]}</span> ${banknoteIconHtml()}` : t('common.notAvailable')}</div>
                    <div class="plan-grid__cell" role="cell">${detailsCell}</div>
                </div>
                ${detailsSection}
            `;
        })
        .join('');

    planTable.innerHTML = `
        <div class="plan-grid__row" role="row">
            <div class="plan-grid__cell plan-grid__cell--header" role="columnheader">${t('analyze.table.source')}</div>
            <div class="plan-grid__cell plan-grid__cell--header" role="columnheader">${t('analyze.table.category')}</div>
            <div class="plan-grid__cell plan-grid__cell--header text-right" role="columnheader">${t('analyze.table.purchases')}</div>
            <div class="plan-grid__cell plan-grid__cell--header text-right" role="columnheader">${t('analyze.table.unitsGained')}</div>
            <div class="plan-grid__cell plan-grid__cell--header text-right" role="columnheader">${t('analyze.table.cost', { icon: banknoteIconHtml() })}</div>
            <div class="plan-grid__cell plan-grid__cell--header text-right" role="columnheader">${t('analyze.table.perUnit', { icon: banknoteIconHtml() })}</div>
            <div class="plan-grid__cell plan-grid__cell--header" role="columnheader"></div>
        </div>
        ${rows}
    `;

    planTable.querySelectorAll(':scope > .plan-grid__row').forEach((row, index) => {
        if (index === 0) {
            return;
        }
        const cell = row.querySelector('.item-cell');
        const { source } = result.plan[index - 1];
        const img = createItemImage(targetItemId, source.name, 'item-icon item-icon--sm');
        cell.appendChild(img);
        cell.appendChild(document.createTextNode(source.name));
    });

    planTable.querySelectorAll('.expand-toggle').forEach((button) => {
        button.addEventListener('click', () => {
            const idx = button.getAttribute('data-plan-index');
            const detailsSection = planTable.querySelector(`[data-plan-details="${idx}"]`);
            const isHidden = detailsSection.hidden;
            detailsSection.hidden = !isHidden;
            button.textContent = isHidden ? t('common.hide') : t('common.details');
        });
    });

    planSummary.innerHTML = t('analyze.planSummary', {
        cost: `<span class="text-gold">${formatThousands(result.totalCost)}</span>`,
        icon: banknoteIconHtml(),
    });
    if (!result.fullyReachable) {
        planWarning.textContent = t('analyze.planWarning', { remaining: formatThousands(result.remaining) });
        planWarning.hidden = false;
    } else {
        planWarning.textContent = '';
        planWarning.hidden = true;
    }
}

function renderSide(side, targetItemId, targetQuantity, activeEventIds, exceedEventPackLimits, limitOptions) {
    if (!targetItemId) {
        side.prompt.hidden = false;
        side.content.hidden = true;
        side.planPrompt.hidden = false;
        side.planContent.hidden = true;
        return;
    }
    side.prompt.hidden = true;
    side.content.hidden = false;
    side.planPrompt.hidden = true;
    side.planContent.hidden = false;

    const itemName = localizedName(data.items[targetItemId]?.name) || targetItemId;
    side.sourcesHeading.textContent = t('compare.sideSourcesHeading', { item: itemName });
    side.planHeading.textContent = t('compare.sidePlanHeading', { item: itemName });

    const { items, packages = {}, exchange_shops: exchangeShops = {} } = data;
    const locale = getLocale();

    // Fresh market per side/recalculation: item A and item B are two independent hypothetical
    // purchases, not a combined shopping list, so neither side's purchase-limit capacity
    // should be consumed by the other.
    const market = createMarket(
        packages,
        exchangeShops,
        items,
        limitOptions,
        { activeEventIds, exceedEventPackLimits },
        locale,
    );

    const packageSources = collectPackageSources(
        targetItemId,
        packages,
        items,
        limitOptions,
        locale,
        activeEventIds,
        exceedEventPackLimits,
    );
    const activeShops = {};
    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        if (shop.event_id && activeEventIds.has(shop.event_id)) {
            activeShops[shopId] = shop;
        }
    }
    const shopFilter = new Set(Object.keys(activeShops));
    const exchangeSources = collectExchangeSources(
        targetItemId,
        activeShops,
        items,
        market.peekUnitCost,
        limitOptions,
        locale,
        activeEventIds,
        exceedEventPackLimits,
    );

    const allSources = [...packageSources, ...exchangeSources].filter((s) => Number.isFinite(s.pricePerUnit));

    if (allSources.length === 0) {
        side.sourcesTable.innerHTML = '';
        side.sourcesEmpty.hidden = false;
        side.planTable.innerHTML = '';
        side.planSummary.textContent = t('analyze.planEmpty');
        side.planWarning.hidden = true;
        return;
    }

    side.sourcesEmpty.hidden = true;
    renderSourcesTable(side.sourcesTable, allSources);

    const result = buildPurchasePlan(market, targetItemId, targetQuantity, shopFilter);
    renderPlanTable(side, result, targetItemId);
}

function renderValueComparison(itemIdA, itemIdB, quantityA, quantityB) {
    if (!itemIdA || !itemIdB || !fairMarket) {
        valuePrompt.hidden = false;
        valueContent.hidden = true;
        return;
    }
    valuePrompt.hidden = true;
    valueContent.hidden = false;

    const nameA = localizedName(data.items[itemIdA]?.name) || itemIdA;
    const nameB = localizedName(data.items[itemIdB]?.name) || itemIdB;

    // Fair-price first; if the bundle-aware solve couldn't settle this item (see
    // lib/ranking-core.js's buildFairPriceMap header), fall back to the same "cheapest known
    // source" pricing the Purchase Comparison section already uses, rather than treating it as
    // entirely unknown. `resolution` tracks which tier each side actually used, for the
    // footnote below.
    function resolveUnitCost(itemId) {
        const fair = fairMarket.peekUnitCost(itemId);
        if (Number.isFinite(fair)) {
            return { cost: fair, resolution: 'fair' };
        }
        const fallback = fallbackCostResolver?.(itemId);
        if (Number.isFinite(fallback)) {
            return { cost: fallback, resolution: 'fallback' };
        }
        return { cost: null, resolution: 'unknown' };
    }

    const resolvedA = resolveUnitCost(itemIdA);
    const resolvedB = resolveUnitCost(itemIdB);
    const knownA = resolvedA.cost !== null;
    const knownB = resolvedB.cost !== null;
    const valueA = Number((knownA ? quantityA * resolvedA.cost : 0).toFixed(2));
    const valueB = Number((knownB ? quantityB * resolvedB.cost : 0).toFixed(2));
    const total = valueA + valueB;
    const pctA = total > 0 ? (valueA / total) * 100 : 50;
    const pctB = total > 0 ? (valueB / total) * 100 : 50;

    compareBar.innerHTML = `
        <div class="compare-bar__track">
            <div class="compare-bar__segment compare-bar__segment--a" style="width: ${pctA}%"></div>
            <div class="compare-bar__segment compare-bar__segment--b" style="width: ${pctB}%"></div>
        </div>
        <div class="compare-bar__labels">
            <div class="compare-bar__label">
                <span class="compare-bar__swatch compare-bar__swatch--a"></span>
                <span>${nameA} &times;${formatThousands(quantityA)}: <span class="text-gold">${formatThousands(valueA)}</span> ${banknoteIconHtml()}</span>
            </div>
            <div class="compare-bar__label">
                <span class="compare-bar__swatch compare-bar__swatch--b"></span>
                <span>${nameB} &times;${formatThousands(quantityB)}: <span class="text-gold">${formatThousands(valueB)}</span> ${banknoteIconHtml()}</span>
            </div>
        </div>
    `;

    const diff = Math.abs(valueA - valueB);
    if (total > 0 && diff <= 1e-9) {
        compareSummary.innerHTML = t('compare.valueSummaryEqual', {
            itemA: nameA,
            itemB: nameB,
            value: `<span class="text-gold">${formatThousands(valueA)}</span>`,
            icon: banknoteIconHtml(),
        });
    } else if (total > 0) {
        const [leaderName, leaderValue, otherName, otherValue] =
            valueA > valueB ? [nameA, valueA, nameB, valueB] : [nameB, valueB, nameA, valueA];
        const ratioText = otherValue > 0 ? (leaderValue / otherValue).toFixed(2) : '∞';
        compareSummary.innerHTML = t('compare.valueSummary', {
            leader: leaderName,
            other: otherName,
            ratio: ratioText,
            leaderValue: `<span class="text-gold">${formatThousands(leaderValue)}</span>`,
            otherValue: `<span class="text-gold">${formatThousands(otherValue)}</span>`,
            icon: banknoteIconHtml(),
        });
    } else {
        compareSummary.textContent = '';
    }

    const fallbackNames = [resolvedA, resolvedB]
        .filter((r) => r.resolution === 'fallback')
        .map((r) => (r === resolvedA ? nameA : nameB));
    const unknownNames = [resolvedA, resolvedB]
        .filter((r) => r.resolution === 'unknown')
        .map((r) => (r === resolvedA ? nameA : nameB));

    const notes = [];
    if (fallbackNames.length > 0) {
        notes.push(t('compare.valueFallbackNote', { items: fallbackNames.join(', ') }));
    }
    if (unknownNames.length > 0) {
        notes.push(t('compare.valueUnknownNote', { items: unknownNames.join(', ') }));
    }
    if (notes.length > 0) {
        compareUnknownNote.innerHTML = notes.join('<br>');
        compareUnknownNote.hidden = false;
    } else {
        compareUnknownNote.textContent = '';
        compareUnknownNote.hidden = true;
    }
}

function syncUrlParams() {
    const url = new URL(window.location.href);
    const params = new URLSearchParams();

    const itemIdA = itemPickerA.getValue();
    const itemIdB = itemPickerB.getValue();
    const eventIds = [...eventMultiSelect.getValues()];
    const quantityA = sides.a.quantityInput?.value?.trim();
    const quantityB = sides.b.quantityInput?.value?.trim();
    const days = daysInput?.value?.trim();
    const lang = new URLSearchParams(url.search).get('lang');

    if (lang) {
        params.set('lang', lang);
    }
    if (itemIdA) {
        params.set('itemA', itemIdA);
    }
    if (itemIdB) {
        params.set('itemB', itemIdB);
    }
    if (eventIds.length > 0) {
        params.set('events', eventIds.join(','));
    }
    if (quantityA && Number(quantityA) > 0) {
        params.set('quantityA', quantityA);
    }
    if (quantityB && Number(quantityB) > 0) {
        params.set('quantityB', quantityB);
    }
    if (days && Number(days) > 1) {
        params.set('days', days);
    }
    if (exceedPackLimitsCheckbox?.checked) {
        params.set('exceedPackLimits', '1');
    }

    const queryString = params.toString();
    const newUrl = `${url.pathname}${queryString ? `?${queryString}` : ''}${url.hash}`;
    window.history.replaceState(null, '', newUrl);
}

function applyUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const itemAParam = params.get('itemA');
    const itemBParam = params.get('itemB');
    const eventsParam = params.get('events');
    const quantityAParam = params.get('quantityA');
    const quantityBParam = params.get('quantityB');
    const daysParam = params.get('days');

    if (itemAParam && data?.items?.[itemAParam]) {
        itemPickerA.setValue(itemAParam);
    }
    if (itemBParam && data?.items?.[itemBParam]) {
        itemPickerB.setValue(itemBParam);
    }
    const eventIds = eventsParam ? eventsParam.split(',').filter((id) => data?.events?.[id]) : [];
    eventMultiSelect.setValues(eventIds);
    sides.a.quantityInput.value = quantityAParam && Number(quantityAParam) > 0 ? quantityAParam : '';
    sides.b.quantityInput.value = quantityBParam && Number(quantityBParam) > 0 ? quantityBParam : '';
    if (daysParam && Number(daysParam) >= 1) {
        daysInput.value = String(Math.floor(Number(daysParam)));
    } else {
        daysInput.value = '1';
    }
    if (exceedPackLimitsCheckbox) {
        exceedPackLimitsCheckbox.checked = params.get('exceedPackLimits') === '1';
    }
}

function recalculate({ syncUrl = true } = {}) {
    if (!data) {
        return;
    }

    const itemIdA = itemPickerA.getValue();
    const itemIdB = itemPickerB.getValue();
    const activeEventIds = eventMultiSelect.getValues();
    const hasActiveEvent = activeEventIds.size > 0;

    if (exceedPackLimitsCheckbox) {
        exceedPackLimitsCheckbox.disabled = !hasActiveEvent;
        if (!hasActiveEvent) {
            exceedPackLimitsCheckbox.checked = false;
        }
    }

    const limitOptions = { days: Number(daysInput ? daysInput.value : 1) || 1 };
    const exceedEventPackLimits = hasActiveEvent && Boolean(exceedPackLimitsCheckbox?.checked);
    const quantityA = effectiveQuantity(sides.a.quantityInput);
    const quantityB = effectiveQuantity(sides.b.quantityInput);

    if (syncUrl) {
        syncUrlParams();
    }

    renderValueComparison(itemIdA, itemIdB, quantityA, quantityB);
    renderSide(sides.a, itemIdA, quantityA, activeEventIds, exceedEventPackLimits, limitOptions);
    renderSide(sides.b, itemIdB, quantityB, activeEventIds, exceedEventPackLimits, limitOptions);
}

function handleReset() {
    itemPickerA.reset();
    itemPickerB.reset();
    eventMultiSelect.reset();
    sides.a.quantityInput.value = '';
    sides.b.quantityInput.value = '';
    daysInput.value = '1';
    if (exceedPackLimitsCheckbox) {
        exceedPackLimitsCheckbox.checked = false;
    }

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
        ? t('footer.compareGenerated', { date: data.metadata.last_updated })
        : t('footer.compareDefault');
}

async function init() {
    data = await loadPackData();
    fairMarket = createFairValueMarket(data, getLocale());
    fallbackCostResolver = buildItemCostResolver(data.packages || {}, data.exchange_shops || {}, data.items || {});
    updateFooter();
    itemPickerA.setItems(data.items || {});
    itemPickerB.setItems(data.items || {});
    populateEventSelect(data.events || {});
    applyUrlParams();

    valueCard.hidden = false;
    costCard.hidden = false;
    planCard.hidden = false;

    window.addEventListener('localechange', () => {
        const selectedEventIds = [...eventMultiSelect.getValues()];
        applyStaticTranslations();
        updateFooter();
        fairMarket = createFairValueMarket(data, getLocale());
        itemPickerA.setItems(data.items || {});
        itemPickerB.setItems(data.items || {});
        populateEventSelect(data.events || {});
        eventMultiSelect.setValues(selectedEventIds);
        recalculate({ syncUrl: false });
    });

    [sides.a.quantityInput, sides.b.quantityInput, daysInput].forEach((input) => {
        if (!input) {
            return;
        }
        input.addEventListener('input', () => recalculate());
        input.addEventListener('change', () => recalculate());
    });
    if (exceedPackLimitsCheckbox) {
        exceedPackLimitsCheckbox.addEventListener('change', () => recalculate());
    }
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
