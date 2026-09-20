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

const ALLIANCE_CHEST_PATTERN = /^lv\d+_alliance_chest$/;

let rawData = null;
let rankings = [];
let itemsById = {};

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
    // `computeTieFlags`. `entry.rank` itself (used for data-rank/data-rank-details identity)
    // always stays its true, unique global ordinal.
    const tieFlags = computeTieFlags(filtered.map((entry) => entry.value_ratio));

    // Both the ranking rows and the nested "Details" breakdown below share the same
    // `.ranking-grid` column tracks (the breakdown uses `grid-template-columns: subgrid`), so
    // their columns always stay visually aligned instead of living in two separate tables.
    const rows = filtered
        .map((entry, index) => {
            const rankLabel = tieFlags[index] ? '' : entry.rank;
            return `
                <div class="ranking-grid__row" role="row" data-rank="${entry.rank}">
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${rankLabel}</div>
                    <div class="ranking-grid__cell" role="cell">${entry.name}${requiresIconHtml(entry.requires, rawData?.packages || {}, itemsById, getLocale())}</div>
                    <div class="ranking-grid__cell" role="cell"><span class="pill pill--${entry.type}">${sourceTypeLabel(entry.type)}</span></div>
                    <div class="ranking-grid__cell" role="cell">${categoryLabel(entry.category)}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${goldenBanknotes(entry.price_display)}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell"><span class="text-gold">${formatThousands(entry.total_value, 2)}</span> ${banknoteIconHtml()}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${formatThousands(entry.value_ratio, 4)}</div>
                    <div class="ranking-grid__cell" role="cell">${entry.value_complete ? `<span class="text-good">${t('common.yes')}</span>` : `<span class="text-bad">${t('common.no')}</span>`}</div>
                    <div class="ranking-grid__cell" role="cell"><button type="button" class="expand-toggle" data-rank="${entry.rank}">${t('common.details')}</button></div>
                </div>
                <div class="ranking-grid__details" data-rank-details="${entry.rank}" hidden>
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
            const rank = button.getAttribute('data-rank');
            const detailsSection = rankingTable.querySelector(`[data-rank-details="${rank}"]`);
            const isHidden = detailsSection.hidden;
            detailsSection.hidden = !isHidden;
            button.textContent = isHidden ? t('common.hide') : t('common.details');
        });
    });
}

function applyFilters() {
    const search = searchInput.value.trim().toLowerCase();
    const filtered = rankings.filter((entry) => matchesFilters(entry, search));
    renderTable(filtered);
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
    recompute();

    searchInput.addEventListener('input', applyFilters);
    includeExchangeShopsCheckbox.addEventListener('change', recompute);
    [excludeDiamondsCheckbox, excludeVipPointsCheckbox, excludeAllianceChestsCheckbox].forEach((checkbox) =>
        checkbox.addEventListener('change', recompute),
    );

    window.addEventListener('localechange', () => {
        applyStaticTranslations();
        recompute();
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
