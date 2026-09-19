import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { createMarket, collectPackageSources, collectExchangeSources } from './lib/pricing-core';
import { buildPurchasePlan } from './lib/purchase-plan';
import { createItemImage, banknoteIconHtml } from './lib/images';
import { createItemPicker } from './lib/item-picker';
import { createMultiSelect } from './lib/multi-select';
import { enableInfoTooltips } from './lib/tooltip';
import { requiresIconHtml } from './lib/requires-tooltip';
import { formatUnitPriceColumn, formatThousands } from './lib/format';
import {
    t,
    getLocale,
    localizedName,
    categoryLabel,
    sourceTypeLabel,
    formatDays,
    applyStaticTranslations,
} from './lib/i18n';

renderNav('analyze');
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
const quantityInput = document.getElementById('quantity-input');
const daysInput = document.getElementById('days-input');
const exceedPackLimitsCheckbox = document.getElementById('exceed-pack-limits-checkbox');
const resetBtn = document.getElementById('reset-btn');
const form = document.getElementById('analyze-form');

const sourcesCard = document.getElementById('sources-card');
const sourcesTable = document.getElementById('sources-table');
const sourcesEmpty = document.getElementById('sources-empty');
const planCard = document.getElementById('plan-card');
const planTable = document.getElementById('plan-table');
const planSummary = document.getElementById('plan-summary');
const planWarning = document.getElementById('plan-warning');
const appFooter = document.querySelector('.app-footer');

let data = null;

function populateEventSelect(events) {
    const sortedEvents = Object.entries(events).sort((a, b) =>
        localizedName(a[1].name).localeCompare(localizedName(b[1].name)),
    );
    eventMultiSelect.setOptions(
        sortedEvents.map(([eventId, event]) => ({ id: eventId, label: localizedName(event.name) })),
    );
}

function renderSourcesTable(sources) {
    const ordered = [...sources].sort((a, b) => a.pricePerUnit - b.pricePerUnit);
    // Every row's "/ Unit" price shares one decimal precision (whatever the smallest value in
    // the column needs to show a non-zero digit) rather than each row rounding independently,
    // so e.g. "1" reads as "1.00" once some other row needs two decimals to not show as "0.00".
    const perUnitDisplay = formatUnitPriceColumn(ordered.map((source) => source.pricePerUnit));

    const rows = ordered
        .map((source, index) => {
            const priceCell =
                source.type === 'exchange'
                    ? source.priceDisplay
                    : `<span class="text-gold">${formatThousands(source.price)}</span> ${banknoteIconHtml()}`;
            const limitCell = Number.isFinite(source.purchaseCapacity)
                ? formatThousands(Number((source.purchaseCapacity * source.yieldPerPurchase).toFixed(2)))
                : t('common.unlimited');
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
                    <td class="text-right">${formatThousands(Number(source.yieldPerPurchase.toFixed(4)))}</td>
                    <td class="text-right">${pricePerUnitCell}</td>
                    <td class="text-right">${limitCell}</td>
                    <td>${formatDays(source.availableDays)}</td>
                </tr>
            `;
        })
        .join('');

    sourcesTable.innerHTML = `
        <thead>
            <tr>
                <th>${t('analyze.table.type')}</th>
                <th>${t('analyze.table.source')}</th>
                <th>${t('analyze.table.category')}</th>
                <th class="text-right">${t('analyze.table.pricePerPurchase')}</th>
                <th class="text-right">${t('analyze.table.yieldPerPurchase')}</th>
                <th class="text-right">${t('analyze.table.perUnit', { icon: banknoteIconHtml() })}</th>
                <th class="text-right">${t('analyze.table.limitUnits')}</th>
                <th>${t('analyze.table.days')}</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    `;
    enableInfoTooltips(sourcesTable);
}

function detailsRowsHtml(details) {
    return details
        .map(
            (detail) => `
                <div class="plan-grid__row">
                    <div class="plan-grid__cell">${detail.source.name}</div>
                    <div class="plan-grid__cell">${categoryLabel(detail.source.category)}</div>
                    <div class="plan-grid__cell">${formatDays(detail.source.availableDays)}</div>
                    <div class="plan-grid__cell text-right">${detail.purchases}</div>
                    <div class="plan-grid__cell text-right">${formatThousands(detail.unitsGained)}</div>
                    <div class="plan-grid__cell text-right"><span class="text-gold">${formatThousands(detail.cost)}</span> ${banknoteIconHtml()}</div>
                </div>
            `,
        )
        .join('');
}

function renderPlanTable(result, targetItemId) {
    if (result.plan.length === 0) {
        planTable.innerHTML = '';
        planSummary.textContent = t('analyze.planEmpty');
        planWarning.hidden = true;
        planWarning.textContent = '';
        return;
    }

    // Both the plan rows and the nested "Details" breakdown below share the same
    // `.plan-grid` column tracks (the breakdown uses `grid-template-columns: subgrid`), so
    // their columns always stay visually aligned instead of living in two separate tables.
    // The "/ Unit" column shares one decimal precision across all rows (see renderSourcesTable).
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
                        <div class="plan-grid__cell plan-grid__cell--header">${t('analyze.table.days')}</div>
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
                    <div class="plan-grid__cell" role="cell">${formatDays(source.availableDays)}</div>
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
            <div class="plan-grid__cell plan-grid__cell--header" role="columnheader">${t('analyze.table.days')}</div>
            <div class="plan-grid__cell plan-grid__cell--header text-right" role="columnheader">${t('analyze.table.purchases')}</div>
            <div class="plan-grid__cell plan-grid__cell--header text-right" role="columnheader">${t('analyze.table.unitsGained')}</div>
            <div class="plan-grid__cell plan-grid__cell--header text-right" role="columnheader">${t('analyze.table.cost', { icon: banknoteIconHtml() })}</div>
            <div class="plan-grid__cell plan-grid__cell--header text-right" role="columnheader">${t('analyze.table.perUnit', { icon: banknoteIconHtml() })}</div>
            <div class="plan-grid__cell plan-grid__cell--header" role="columnheader"></div>
        </div>
        ${rows}
    `;

    // Fill in the item-image + source-name cell for each row (kept out of the template
    // string above since createItemImage() builds a real DOM node, not markup). Scoped to
    // direct children of the grid so the nested "Details" breakdown rows (which reuse the
    // same `.plan-grid__row`/`.plan-grid__cell` classes, just further down the subtree)
    // aren't counted here.
    planTable.querySelectorAll(':scope > .plan-grid__row').forEach((row, index) => {
        // index 0 is the header row; plan rows start at index 1.
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

function syncUrlParams() {
    const url = new URL(window.location.href);
    const params = new URLSearchParams();

    const itemId = itemPicker.getValue();
    const eventIds = [...eventMultiSelect.getValues()];
    const quantity = quantityInput?.value?.trim();
    const days = daysInput?.value?.trim();
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
    if (quantity && Number(quantity) > 0) {
        params.set('quantity', quantity);
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
    const itemParam = params.get('item');
    const eventsParam = params.get('events');
    const quantityParam = params.get('quantity') || params.get('amount');
    const daysParam = params.get('days');

    if (itemParam && data?.items?.[itemParam]) {
        itemPicker.setValue(itemParam);
    }
    const eventIds = eventsParam ? eventsParam.split(',').filter((id) => data?.events?.[id]) : [];
    eventMultiSelect.setValues(eventIds);
    if (quantityParam && Number(quantityParam) > 0) {
        quantityInput.value = quantityParam;
    } else {
        quantityInput.value = '';
    }
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

    const targetItemId = itemPicker.getValue();
    // The selection IS the set of currently active event ids: each option in the multi-select
    // is an entry from `data.events` (whether or not that event has its own exchange shop).
    const activeEventIds = eventMultiSelect.getValues();
    const hasActiveEvent = activeEventIds.size > 0;

    // "Exceed event limits" only makes sense once an event is actually active; keep it
    // disabled and cleared otherwise so a stale checked state never lingers from before the
    // last event was deselected.
    if (exceedPackLimitsCheckbox) {
        exceedPackLimitsCheckbox.disabled = !hasActiveEvent;
        if (!hasActiveEvent) {
            exceedPackLimitsCheckbox.checked = false;
        }
    }

    const limitOptions = {
        days: Number(daysInput ? daysInput.value : 1) || 1,
    };
    const exceedEventPackLimits = hasActiveEvent && Boolean(exceedPackLimitsCheckbox?.checked);
    const targetQuantity = Number(quantityInput ? quantityInput.value : 0) || 0;

    if (syncUrl) {
        syncUrlParams();
    }

    if (!targetItemId) {
        sourcesCard.hidden = true;
        planCard.hidden = true;
        return;
    }

    const { items, packages = {}, exchange_shops: exchangeShops = {} } = data;
    const locale = getLocale();

    // The market always sees every package/exchange shop, since the "Active Events" selection
    // only restricts which shop may sell the target item *directly* (via `activeShops` below);
    // the currency needed to pay for any exchange offer (target item or otherwise) can still
    // come from any shop. A fresh market is created per recalculation so purchase-limit
    // capacities start out unconsumed.
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
    // A shop counts as "active" exactly when its own event is currently selected (shops with
    // no event_id can never be activated this way, but none exist in the data today).
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

    sourcesCard.hidden = false;
    if (allSources.length === 0) {
        sourcesTable.innerHTML = '';
        sourcesEmpty.hidden = false;
        planCard.hidden = true;
        return;
    }

    sourcesEmpty.hidden = true;
    renderSourcesTable(allSources);

    if (targetQuantity > 0) {
        const result = buildPurchasePlan(market, targetItemId, targetQuantity, shopFilter);
        planCard.hidden = false;
        renderPlanTable(result, targetItemId);
    } else {
        planCard.hidden = true;
    }
}

function handleReset() {
    itemPicker.reset();
    eventMultiSelect.reset();
    if (quantityInput) {
        quantityInput.value = '';
    }
    if (daysInput) {
        daysInput.value = '1';
    }
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
        ? t('footer.analyzeGenerated', { date: data.metadata.last_updated })
        : t('footer.analyzeDefault');
}

async function init() {
    data = await loadPackData();
    updateFooter();
    itemPicker.setItems(data.items || {});
    populateEventSelect(data.events || {});
    applyUrlParams();

    window.addEventListener('localechange', () => {
        const selectedEventIds = [...eventMultiSelect.getValues()];
        applyStaticTranslations();
        updateFooter();
        // Re-affirms the currently selected item's display text in the new locale; both
        // pickers keep their own selection state across a setItems()/setOptions() call, unlike
        // a native <select> whose value resets when its <option>s are replaced (hence the
        // event capture/restore just below still being necessary).
        itemPicker.setItems(data.items || {});
        populateEventSelect(data.events || {});
        eventMultiSelect.setValues(selectedEventIds);
        recalculate({ syncUrl: false });
    });

    if (quantityInput) {
        quantityInput.addEventListener('input', () => recalculate());
        quantityInput.addEventListener('change', () => recalculate());
    }
    if (daysInput) {
        daysInput.addEventListener('input', () => recalculate());
        daysInput.addEventListener('change', () => recalculate());
    }
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
