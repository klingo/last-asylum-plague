import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { buildRanking } from './lib/ranking-core';
import { createItemImage, banknoteIconHtml } from './lib/images';
import { enableInfoTooltips } from './lib/tooltip';
import { requiresIconHtml } from './lib/requires-tooltip';
import { t, getLocale, categoryLabel, sourceTypeLabel, applyStaticTranslations } from './lib/i18n';
import { formatUnitPrice, formatThousands, computeTieFlags } from './lib/format';

renderNav('rankings');
applyStaticTranslations();

const searchInput = document.getElementById('search-input');
const includeExchangeShopsCheckbox = document.getElementById('include-exchange-shops');
const excludeDiamondsCheckbox = document.getElementById('exclude-diamonds');
const excludeVipPointsCheckbox = document.getElementById('exclude-vip-points');
const excludeAllianceChestsCheckbox = document.getElementById('exclude-alliance-chests');
const rankingMeta = document.getElementById('ranking-meta');
const rankingTable = document.getElementById('ranking-table');
const rankingEmpty = document.getElementById('ranking-empty');
const loadingOverlay = document.getElementById('loading-overlay');

const ALLIANCE_CHEST_PATTERN = /^lv\d+_alliance_chest$/;

let rawData = null;
let rankings = [];
let itemsById = {};
// Entry keys (see `entryKey`) whose "Details" row is currently expanded, so a re-render
// triggered by something that doesn't change WHICH entries exist (search, an exclude-item
// checkbox) can restore the same rows open instead of collapsing everything. Deliberately not
// keyed by `entry.rank`: excluding an item changes value_ratio and can reorder the whole list,
// so the entry that was open could end up at a different rank after recompute. Cleared
// explicitly wherever the entry list itself can change (see includeExchangeShopsCheckbox's
// listener).
const expandedEntryKeys = new Set();

function entryKey(entry) {
    return `${entry.type}:${entry.id}`;
}

function matchesFilters(entry, search) {
    if (!search) {
        return true;
    }
    const haystack = `${entry.name} ${categoryLabel(entry.category)}`.toLowerCase();
    return haystack.includes(search);
}

function getExcludeItemIds() {
    const excludeItemIds = new Set();
    if (excludeDiamondsCheckbox.checked) {
        excludeItemIds.add('diamonds');
    }
    if (excludeVipPointsCheckbox.checked) {
        excludeItemIds.add('vip_points');
    }
    if (excludeAllianceChestsCheckbox.checked) {
        for (const itemId of Object.keys(rawData?.items || {})) {
            if (ALLIANCE_CHEST_PATTERN.test(itemId)) {
                excludeItemIds.add(itemId);
            }
        }
    }
    return excludeItemIds;
}

function goldenBanknotes(text) {
    const currency = t('currency.banknotes');
    const pattern = new RegExp(`([\\d.,']+)\\s*${currency}`, 'g');
    return text.replace(pattern, (match, amount) => `<span class="text-gold">${amount}</span> ${banknoteIconHtml()}`);
}

function breakdownRowsHtml(entry) {
    return entry.contains_breakdown
        .map(
            (item) => `
                <div class="ranking-grid__row">
                    <div class="ranking-grid__cell"></div>
                    <div class="ranking-grid__cell item-cell"><span class="breakdown-icon" data-item-id="${item.item_id}"></span>${item.name} &times;${item.quantity}</div>
                    <div class="ranking-grid__cell"></div>
                    <div class="ranking-grid__cell">${categoryLabel(itemsById[item.item_id]?.category)}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num">${item.unit_cost !== null ? `<span class="text-gold">${formatUnitPrice(item.unit_cost, { minDecimals: 4 })}</span> ${banknoteIconHtml()}` : t('common.unknown')}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num"><span class="text-gold">${formatThousands(item.value, 2)}</span> ${banknoteIconHtml()}</div>
                    <div class="ranking-grid__cell"></div>
                    <div class="ranking-grid__cell">${item.known === false ? `<span class="text-bad">${t('rankings.table.incomplete')}</span>` : ''}</div>
                    <div class="ranking-grid__cell"></div>
                </div>
            `,
        )
        .join('');
}

function renderTable(filtered) {
    if (filtered.length === 0) {
        rankingTable.innerHTML = '';
        rankingEmpty.hidden = false;
        return;
    }
    rankingEmpty.hidden = true;

    // Competition ranking: entries tied on Value Ratio with the row directly above them (same
    // rounded value, so a visible tie) show a blank rank instead of repeating the number — see
    // `computeTieFlags`. `entry.rank` is purely the displayed number here; row identity for
    // expand/collapse state uses the stable `entryKey`, not the (recompute-reorderable) rank.
    const tieFlags = computeTieFlags(filtered.map((entry) => entry.value_ratio));

    // Both the ranking rows and the nested "Details" breakdown below share the same
    // `.ranking-grid` column tracks (the breakdown uses `grid-template-columns: subgrid`), so
    // their columns always stay visually aligned instead of living in two separate tables.
    const rows = filtered
        .map((entry, index) => {
            const rankLabel = tieFlags[index] ? '' : entry.rank;
            const key = entryKey(entry);
            return `
                <div class="ranking-grid__row" role="row" data-entry-key="${key}">
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${rankLabel}</div>
                    <div class="ranking-grid__cell" role="cell">${entry.name}${requiresIconHtml(entry.requires, rawData?.packages || {}, itemsById, getLocale())}</div>
                    <div class="ranking-grid__cell" role="cell"><span class="pill pill--${entry.type}">${sourceTypeLabel(entry.type)}</span></div>
                    <div class="ranking-grid__cell" role="cell">${categoryLabel(entry.category)}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${goldenBanknotes(entry.price_display)}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell"><span class="text-gold">${formatThousands(entry.total_value, 2)}</span> ${banknoteIconHtml()}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${formatThousands(entry.value_ratio, 4)}</div>
                    <div class="ranking-grid__cell" role="cell">${entry.value_complete ? `<span class="text-good">${t('common.yes')}</span>` : `<span class="text-bad">${t('common.no')}</span>`}</div>
                    <div class="ranking-grid__cell" role="cell"><button type="button" class="expand-toggle" data-entry-key="${key}">${t('common.details')}</button></div>
                </div>
                <div class="ranking-grid__details" data-entry-key-details="${key}" hidden>
                    <div class="ranking-grid__row">
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header">${t('rankings.table.item')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header">${t('rankings.table.category')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num">${t('rankings.table.unitCost')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num">${t('rankings.table.value', { icon: banknoteIconHtml() })}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                    </div>
                    ${breakdownRowsHtml(entry)}
                </div>
            `;
        })
        .join('');

    rankingTable.innerHTML = `
        <div class="ranking-grid__row" role="row">
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('rankings.table.rank')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">${t('rankings.table.name')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">${t('rankings.table.type')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">${t('rankings.table.category')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('rankings.table.price')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('rankings.table.value', { icon: banknoteIconHtml() })}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('rankings.table.valueRatio')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">${t('rankings.table.complete')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader"></div>
        </div>
        ${rows}
    `;

    // Populate item images (real DOM nodes, can't be inlined into the HTML string above).
    rankingTable.querySelectorAll('[data-item-id]').forEach((placeholder) => {
        const itemId = placeholder.getAttribute('data-item-id');
        const img = createItemImage(itemId, itemId, 'item-icon item-icon--sm');
        placeholder.replaceWith(img);
    });
    enableInfoTooltips(rankingTable);

    rankingTable.querySelectorAll('.expand-toggle').forEach((button) => {
        button.addEventListener('click', () => {
            const key = button.getAttribute('data-entry-key');
            const detailsSection = rankingTable.querySelector(`[data-entry-key-details="${key}"]`);
            const isHidden = detailsSection.hidden;
            detailsSection.hidden = !isHidden;
            button.textContent = isHidden ? t('common.hide') : t('common.details');
            if (isHidden) {
                expandedEntryKeys.add(key);
            } else {
                expandedEntryKeys.delete(key);
            }
        });
    });

    // Re-open whatever was expanded before this render, for entries still present now (e.g.
    // still matching the search, or simply the same entry re-rendered with new value numbers).
    expandedEntryKeys.forEach((key) => {
        const detailsSection = rankingTable.querySelector(`[data-entry-key-details="${key}"]`);
        const button = rankingTable.querySelector(`.expand-toggle[data-entry-key="${key}"]`);
        if (!detailsSection || !button) {
            return;
        }
        detailsSection.hidden = false;
        button.textContent = t('common.hide');
    });
}

function applyFilters() {
    const search = searchInput.value.trim().toLowerCase();
    const filtered = rankings.filter((entry) => matchesFilters(entry, search));
    renderTable(filtered);
}

// Bundle-aware pricing (see lib/ranking-core.js) can take a noticeable moment to recompute, so
// any change that triggers it shows a blocking overlay first. `recompute()` itself is
// synchronous, so simply toggling the overlay around a direct call would never actually get
// painted — the browser wouldn't get a chance to render before the heavy computation blocked
// the main thread. Deferring the computation one tick (setTimeout 0) lets the overlay's
// `hidden = false` reach the screen first.
function withLoadingOverlay(fn) {
    loadingOverlay.hidden = false;
    setTimeout(() => {
        try {
            fn();
        } finally {
            loadingOverlay.hidden = true;
        }
    }, 0);
}

function recompute() {
    itemsById = rawData.items || {};
    const result = buildRanking(rawData, getLocale(), {
        excludeExchangeShops: !includeExchangeShopsCheckbox.checked,
        excludeItemIds: getExcludeItemIds(),
    });
    rankings = result.rankings || [];
    const meta = result.metadata || {};
    const generatedAt = meta.generated_at ? new Date(meta.generated_at).toLocaleString(getLocale()) : '';
    rankingMeta.textContent = `${t('rankings.meta', { count: meta.entry_count ?? rankings.length, date: generatedAt })} ${meta.note || ''}`;
    applyFilters();
}

async function init() {
    rawData = await loadPackData();
    withLoadingOverlay(recompute);

    searchInput.addEventListener('input', applyFilters);
    includeExchangeShopsCheckbox.addEventListener('change', () => {
        // The entry list itself can change (exchange offers/bonus tiers appearing or
        // disappearing entirely), so any previously expanded rows may no longer correspond to
        // the same entry — collapse instead of risking a stale/misleading open row.
        expandedEntryKeys.clear();
        withLoadingOverlay(recompute);
    });
    [excludeDiamondsCheckbox, excludeVipPointsCheckbox, excludeAllianceChestsCheckbox].forEach((checkbox) =>
        checkbox.addEventListener('change', () => withLoadingOverlay(recompute)),
    );

    window.addEventListener('localechange', () => {
        applyStaticTranslations();
        withLoadingOverlay(recompute);
    });
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
