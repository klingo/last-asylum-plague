import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { buildSpendRewardTracks } from './lib/ranking-core';
import { createItemImage, banknoteIconHtml } from './lib/images';
import { enableInfoTooltips } from './lib/tooltip';
import { t, getLocale, categoryLabel, applyStaticTranslations } from './lib/i18n';
import { formatUnitPrice, formatThousands } from './lib/format';

renderNav('spend-rewards');
applyStaticTranslations();

const trackSelect = document.getElementById('track-select');
const fallbackCheckbox = document.getElementById('fallback-checkbox');
const tiersPrompt = document.getElementById('tiers-prompt');
const tiersEmpty = document.getElementById('tiers-empty');
const tiersWrap = document.getElementById('tiers-wrap');
const tiersTable = document.getElementById('tiers-table');
const tiersNote = document.getElementById('tiers-note');
const loadingOverlay = document.getElementById('loading-overlay');

let rawData = null;
let itemsById = {};
let tracks = [];
// Tier keys (see `tierKey`) whose "Details" row is currently expanded, restored across a
// re-render triggered by something that doesn't change which tiers exist (a locale switch).
const expandedTierKeys = new Set();

function tierKey(trackId, tier) {
    return `${trackId}:${tier.threshold}`;
}

// --bad -> --good (see style.css) in RGB, interpolated per tier's ratio-bar fill below.
const RATIO_BAD_RGB = [242, 104, 92];
const RATIO_GOOD_RGB = [99, 214, 138];

function ratioBarColor(fraction) {
    const channel = (from, to) => Math.round(from + (to - from) * fraction);
    return `rgb(${channel(RATIO_BAD_RGB[0], RATIO_GOOD_RGB[0])}, ${channel(RATIO_BAD_RGB[1], RATIO_GOOD_RGB[1])}, ${channel(RATIO_BAD_RGB[2], RATIO_GOOD_RGB[2])})`;
}

// Scales a tier's ratio-bar fill from 0 (ratio 0, "worthless") to 1 (this track's own best ratio
// among its CURRENTLY displayed tiers) — a fixed floor but a relative ceiling, since there's no
// natural upper bound on value ratio to anchor 100% to otherwise. Deliberately not anchored to 1.0
// ("break-even"): a below-1 ratio is still a real, non-zero amount of value, and pinning it to the
// same 0-fill as an actually worthless tier would visually flatten that distinction.
function ratioBarFraction(ratio, maxRatio) {
    if (!Number.isFinite(ratio) || maxRatio <= 0) {
        return 0;
    }
    return Math.min(1, Math.max(0, ratio / maxRatio));
}

function breakdownRowsHtml(tier) {
    return [...tier.contains_breakdown]
        .sort((a, b) => b.value - a.value)
        .map(
            (item) => `
                <div class="ranking-grid__row">
                    <div class="ranking-grid__cell item-cell"><span class="breakdown-icon" data-item-id="${item.item_id}"></span>${item.name} &times;${item.quantity}</div>
                    <div class="ranking-grid__cell">${categoryLabel(itemsById[item.item_id]?.category)}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num">${item.unit_cost !== null ? `<span class="text-gold">${formatUnitPrice(item.unit_cost, { minDecimals: 4 })}</span> ${banknoteIconHtml()}` : t('common.unknown')}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num"><span class="text-gold">${formatThousands(item.value, 2)}</span> ${banknoteIconHtml()}</div>
                    <div class="ranking-grid__cell"></div>
                    <div class="ranking-grid__cell">${
                        item.known === false
                            ? `<span class="text-bad">${t('rankings.table.incomplete')}</span>`
                            : item.estimated
                              ? `<span class="text-warn">${t('spendRewards.table.estimated')}</span>`
                              : ''
                    }</div>
                    <div class="ranking-grid__cell"></div>
                </div>
            `,
        )
        .join('');
}

function renderTiers(track) {
    if (!track || track.tiers.length === 0) {
        tiersWrap.hidden = true;
        tiersNote.hidden = true;
        tiersPrompt.hidden = true;
        tiersEmpty.hidden = false;
        return;
    }
    tiersPrompt.hidden = true;
    tiersEmpty.hidden = true;
    tiersWrap.hidden = false;
    tiersNote.hidden = false;
    tiersNote.textContent = t('spendRewards.note');

    const maxRatio = track.tiers.reduce(
        (max, tier) => (Number.isFinite(tier.value_ratio) ? Math.max(max, tier.value_ratio) : max),
        1,
    );

    const rows = track.tiers
        .map((tier, index) => {
            const key = tierKey(track.id, tier);
            const ratioFraction = ratioBarFraction(tier.value_ratio, maxRatio);
            const ratioColor = ratioBarColor(ratioFraction);
            const tierLabel = t('spendRewards.tierLabel', { tier: index + 1 });
            return `
                <div class="ranking-grid__row" role="row" data-tier-key="${key}">
                    <div class="ranking-grid__cell" role="cell">${
                        track.uses_points
                            ? `${tierLabel} (<span class="text-gold">${formatThousands(tier.threshold)}</span>&nbsp;${t('spendRewards.pointsSuffix')})`
                            : tierLabel
                    }</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell"><span class="text-gold">${formatThousands(tier.cumulative_cost, 2)}</span> ${banknoteIconHtml()}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell"><span class="text-gold">${formatThousands(tier.step_cost, 2)}</span> ${banknoteIconHtml()}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell"><span class="text-gold">${formatThousands(tier.total_value, 2)}</span> ${banknoteIconHtml()}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">
                        <div class="ratio-display">
                            <span>${formatThousands(tier.value_ratio, 4)}</span>
                            <span class="ratio-bar"><span class="ratio-bar__fill" style="width: ${(ratioFraction * 100).toFixed(1)}%; background: ${ratioColor}"></span></span>
                        </div>
                    </div>
                    <div class="ranking-grid__cell" role="cell">${
                        tier.value_complete
                            ? tier.value_estimated
                                ? `<span class="text-warn">${t('spendRewards.table.estimatedShort')}</span>`
                                : `<span class="text-good">${t('common.yes')}</span>`
                            : `<span class="text-bad">${t('common.no')}</span>`
                    }</div>
                    <div class="ranking-grid__cell" role="cell"><button type="button" class="expand-toggle" data-tier-key="${key}">${t('common.details')}</button></div>
                </div>
                <div class="ranking-grid__details" data-tier-key-details="${key}" hidden>
                    <div class="ranking-grid__row">
                        <div class="ranking-grid__cell ranking-grid__cell--header">${t('spendRewards.table.item')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header">${t('rankings.table.category')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num">${t('spendRewards.table.unitCost')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num">${t('spendRewards.table.value', { icon: banknoteIconHtml() })}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                    </div>
                    ${breakdownRowsHtml(tier)}
                </div>
            `;
        })
        .join('');

    tiersTable.innerHTML = `
        <div class="ranking-grid__row" role="row">
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">${t('spendRewards.table.tier')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('spendRewards.table.threshold')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('spendRewards.table.stepCost')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('spendRewards.table.value', { icon: banknoteIconHtml() })}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('spendRewards.table.valueRatio')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">${t('spendRewards.table.complete')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader"></div>
        </div>
        ${rows}
    `;

    tiersTable.querySelectorAll('[data-item-id]').forEach((placeholder) => {
        const itemId = placeholder.getAttribute('data-item-id');
        const img = createItemImage(itemId, itemId, 'item-icon item-icon--sm');
        placeholder.replaceWith(img);
    });
    enableInfoTooltips(tiersTable);

    tiersTable.querySelectorAll('.expand-toggle').forEach((button) => {
        button.addEventListener('click', () => {
            const key = button.getAttribute('data-tier-key');
            const detailsSection = tiersTable.querySelector(`[data-tier-key-details="${key}"]`);
            const isHidden = detailsSection.hidden;
            detailsSection.hidden = !isHidden;
            button.textContent = isHidden ? t('common.hide') : t('common.details');
            if (isHidden) {
                expandedTierKeys.add(key);
            } else {
                expandedTierKeys.delete(key);
            }
        });
    });

    expandedTierKeys.forEach((key) => {
        const detailsSection = tiersTable.querySelector(`[data-tier-key-details="${key}"]`);
        const button = tiersTable.querySelector(`.expand-toggle[data-tier-key="${key}"]`);
        if (!detailsSection || !button) {
            return;
        }
        detailsSection.hidden = false;
        button.textContent = t('common.hide');
    });
}

function populateTrackSelect() {
    const previousValue = trackSelect.value;
    const optionsHtml = tracks.map((track) => `<option value="${track.id}">${track.name}</option>`).join('');
    trackSelect.innerHTML = `<option value="" disabled ${previousValue ? '' : 'selected'}>${t('spendRewards.trackPlaceholder')}</option>${optionsHtml}`;
    if (tracks.some((track) => track.id === previousValue)) {
        trackSelect.value = previousValue;
    }
}

// Bundle-aware pricing (see lib/ranking-core.js) can take a noticeable moment to recompute, so
// any change that triggers it shows a blocking overlay first (see rankings.js for why the
// setTimeout is needed for the overlay to actually paint before the heavy synchronous work runs).
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
    const result = buildSpendRewardTracks(rawData, getLocale(), { useNaiveFallback: fallbackCheckbox.checked });
    tracks = result.tracks || [];
    populateTrackSelect();

    if (tracks.length === 0) {
        tiersPrompt.hidden = true;
        tiersWrap.hidden = true;
        tiersNote.hidden = true;
        tiersEmpty.hidden = false;
        return;
    }

    const selected = tracks.find((track) => track.id === trackSelect.value);
    if (!selected) {
        tiersEmpty.hidden = true;
        tiersWrap.hidden = true;
        tiersNote.hidden = true;
        tiersPrompt.hidden = false;
        return;
    }
    renderTiers(selected);
}

async function init() {
    rawData = await loadPackData();
    withLoadingOverlay(recompute);

    trackSelect.addEventListener('change', () => {
        expandedTierKeys.clear();
        withLoadingOverlay(recompute);
    });

    fallbackCheckbox.addEventListener('change', () => withLoadingOverlay(recompute));

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
