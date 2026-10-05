import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { buildValuation, modelSummaryText, planOptions } from './lib/valuation';
import { solveWeeklyPlan } from './lib/planner.js';
import { mountValuationPanel } from './lib/valuation-panel';
import { withLoading } from './lib/loading';
import { trackTiers, trackPointsForPrice } from './lib/spend-tracks.js';
import { itemDisplayName } from './lib/labels';
import { createItemImage, banknoteIconHtml } from './lib/images';
import { t, getLocale, localizedName, categoryLabel, applyStaticTranslations } from './lib/i18n';
import { formatThousands, formatSignificant } from './lib/format';
import { ratioBarHtml } from './lib/ratio-bar';

renderNav('spend-rewards');
applyStaticTranslations();

const trackSelect = document.getElementById('track-select');
const tiersPrompt = document.getElementById('tiers-prompt');
const tiersEmpty = document.getElementById('tiers-empty');
const tiersWrap = document.getElementById('tiers-wrap');
const tiersTable = document.getElementById('tiers-table');
const tiersNote = document.getElementById('tiers-note');

let data = null;
let settings = null;
let valuation = null;
const expandedKeys = new Set();

const gold = (text) => `<span class="text-gold">${text}</span> ${banknoteIconHtml()}`;

function breakdownRowsHtml(tier) {
    const locale = getLocale();
    return tier.value.parts
        .map((part) => ({ ...part, worth: part.qty * (valuation.worth(part.id) ?? 0) }))
        .sort((a, b) => b.worth - a.worth)
        .map(
            (part) => `
                <div class="ranking-grid__row">
                    <div class="ranking-grid__cell item-cell"><span class="breakdown-icon" data-item-id="${part.id}"></span>${itemDisplayName(data.items, part.id, locale)} &times;${formatSignificant(part.qty)}</div>
                    <div class="ranking-grid__cell">${categoryLabel(data.items[part.id]?.category)}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num">${formatSignificant(valuation.points(part.id)) ?? t('common.unknown')}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num">${gold(formatSignificant(part.worth))}</div>
                    <div class="ranking-grid__cell"></div>
                    <div class="ranking-grid__cell">${valuation.worth(part.id) === null ? `<span class="text-bad">${t('rankings.table.incomplete')}</span>` : ''}</div>
                    <div class="ranking-grid__cell"></div>
                </div>`,
        )
        .join('');
}

/**
 * What each tier step is worth: the weekly plan at the tier's total spend (with the track running)
 * minus the plan at the previous tier's total, i.e. the best packs the extra Banknotes still buy
 * plus the tier reward, in Banknotes at your weekly spend. Ratio = that ÷ the step's Banknotes:
 * at least 1 = the step is as good as your last Banknote at your weekly spend.
 */
function stepAnalysis(track, trackId) {
    const activeTrackIds = new Set([trackId]);
    const reachedTier = (plan, tier) =>
        plan.trackTiersReached.some((r) => r.trackId === trackId && r.threshold === tier.threshold);
    let previousPoints = 0;
    let previousSpent = 0;
    return trackTiers(track).map((tier) => {
        // Spend about the threshold's worth of Banknotes (track points per Banknote ~1, rounded down
        // by the pack prices), a little more if the packs on sale can't quite reach it.
        let budget = Math.max(tier.cumulativeCost, trackPointsBudget(track, tier.threshold));
        let plan = null;
        for (let attempt = 0; attempt < 4; attempt++) {
            plan = solveWeeklyPlan(valuation.highs, data, planOptions(data, settings, { budget, activeTrackIds }));
            if (reachedTier(plan, tier)) {
                break;
            }
            budget = Math.ceil(budget * 1.02);
        }
        const stepCost = plan.spent - previousSpent;
        const stepWorth = (plan.totalPoints - previousPoints) / valuation.rate;
        previousPoints = plan.totalPoints;
        previousSpent = plan.spent;
        const reached = reachedTier(plan, tier);
        const reward = valuation.bundle({ contains: tier.rewards }, 0);
        return {
            ...tier,
            cumulativeCost: plan.spent,
            stepCost,
            reward,
            reached,
            stepWorth,
            packsWorth: stepWorth - (reached ? reward.worth : 0),
            ratio: stepCost > 0 ? stepWorth / stepCost : null,
        };
    });
}

/** Banknotes that earn `points` track points at the track's typical rate. */
function trackPointsBudget(track, points) {
    const perBanknote = trackPointsForPrice(track, 1000) / 1000;
    return Math.ceil(points / perBanknote);
}

let stepCache = { key: null, tiers: null };

function render() {
    const trackId = trackSelect.value;
    const track = data.spend_reward_tracks?.[trackId];
    tiersPrompt.hidden = Boolean(track);
    if (!track) {
        tiersWrap.hidden = true;
        tiersNote.hidden = true;
        tiersEmpty.hidden = true;
        return;
    }
    const usesPoints = Array.isArray(track.conversions) && track.conversions.length > 0;
    const cacheKey = `${trackId}|${JSON.stringify(settings)}`;
    if (stepCache.key !== cacheKey) {
        stepCache = { key: cacheKey, tiers: stepAnalysis(track, trackId) };
    }
    const tiers = stepCache.tiers.map((tier) => ({ ...tier, value: tier.reward }));
    tiersEmpty.hidden = tiers.length > 0;
    tiersWrap.hidden = tiers.length === 0;
    tiersNote.hidden = tiers.length === 0;
    const lastWorthIt = tiers.reduce((last, tier, index) => (tier.ratio >= 1 ? index : last), -1);
    const verdict =
        lastWorthIt >= 0
            ? t('spendRewards.verdict', {
                  tier: lastWorthIt + 1,
                  total: formatThousands(tiers[lastWorthIt].cumulativeCost, 0),
              })
            : t('spendRewards.verdictNone');
    tiersNote.textContent = `${verdict} ${t('spendRewards.note')} ${modelSummaryText(valuation)}`;

    const maxRatio = Math.max(1, ...tiers.map((tier) => tier.ratio).filter(Number.isFinite));
    const rows = tiers
        .map((tier, index) => {
            const key = `${trackId}:${tier.threshold}`;
            const label = t('spendRewards.tierLabel', { tier: index + 1 });
            return `
                <div class="ranking-grid__row" role="row">
                    <div class="ranking-grid__cell" role="cell">${usesPoints ? `${label} (<span class="text-gold">${formatThousands(tier.threshold)}</span>&nbsp;${t('spendRewards.pointsSuffix')})` : label}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${gold(formatThousands(tier.cumulativeCost, 0))}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${gold(formatThousands(tier.stepCost, 0))}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${gold(formatThousands(tier.packsWorth, 0))}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${tier.reached ? gold(formatThousands(tier.reward.worth, 0)) : `<span class="text-dim">${t('spendRewards.notReached')}</span>`}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">
                        ${ratioBarHtml(tier.ratio, maxRatio, { digits: 3 })}
                    </div>
                    <div class="ranking-grid__cell" role="cell"><button type="button" class="expand-toggle" data-tier-key="${key}">${expandedKeys.has(key) ? t('common.hide') : t('common.details')}</button></div>
                </div>
                <div class="ranking-grid__details" data-tier-key-details="${key}" ${expandedKeys.has(key) ? '' : 'hidden'}>
                    <div class="ranking-grid__row">
                        <div class="ranking-grid__cell ranking-grid__cell--header">${t('spendRewards.table.item')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header">${t('rankings.table.category')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num">${t('rankings.table.pointsEach')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num">${t('rankings.table.worth')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                    </div>
                    ${breakdownRowsHtml(tier)}
                </div>`;
        })
        .join('');

    tiersTable.innerHTML = `
        <div class="ranking-grid__row" role="row">
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">${t('spendRewards.table.tier')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('spendRewards.table.threshold')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('spendRewards.table.stepCost')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('spendRewards.table.packs')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('spendRewards.table.worth')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('spendRewards.table.ratio')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader"></div>
        </div>
        ${rows}`;

    tiersTable.querySelectorAll('[data-item-id]').forEach((placeholder) => {
        const itemId = placeholder.getAttribute('data-item-id');
        placeholder.replaceWith(createItemImage(itemId, itemId, 'item-icon item-icon--sm'));
    });
    tiersTable.querySelectorAll('.expand-toggle').forEach((button) => {
        button.addEventListener('click', () => {
            const key = button.getAttribute('data-tier-key');
            const details = tiersTable.querySelector(`[data-tier-key-details="${key}"]`);
            details.hidden = !details.hidden;
            button.textContent = details.hidden ? t('common.details') : t('common.hide');
            if (details.hidden) {
                expandedKeys.delete(key);
            } else {
                expandedKeys.add(key);
            }
        });
    });
}

function populateTrackSelect() {
    const previous = trackSelect.value;
    const options = Object.entries(data.spend_reward_tracks || {})
        .map(([id, track]) => `<option value="${id}">${localizedName(track.name)}</option>`)
        .join('');
    trackSelect.innerHTML = `<option value="" disabled ${previous ? '' : 'selected'}>${t('spendRewards.trackPlaceholder')}</option>${options}`;
    if (previous && data.spend_reward_tracks?.[previous]) {
        trackSelect.value = previous;
    }
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
        fields: ['budget', 'events', 'passes'],
        onChange: (next) => {
            settings = next;
            recompute();
        },
    });
    settings = panel.getSettings();
    populateTrackSelect();
    trackSelect.addEventListener('change', () => {
        expandedKeys.clear();
        withLoading(render);
    });
    window.addEventListener('localechange', () => {
        applyStaticTranslations();
        populateTrackSelect();
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
