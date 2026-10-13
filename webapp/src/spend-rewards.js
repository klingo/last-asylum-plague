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
import { t, getLocale, categoryLabel, applyStaticTranslations } from './lib/i18n';
import { formatThousands, formatSignificant } from './lib/format';
import { ratioBarHtml } from './lib/ratio-bar';
import { createItemPicker } from './lib/item-picker';

renderNav('spend-rewards');
applyStaticTranslations();

// The app's own picker (as on the other pages), not a native <select>.
const trackPicker = createItemPicker({
    trigger: document.getElementById('track-select'),
    placeholderKey: 'spendRewards.trackPlaceholder',
    searchPlaceholderKey: 'spendRewards.trackSearch',
    icons: false,
    onChange: () => {
        expandedKeys.clear();
        withLoading(render);
    },
});
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
                    <div class="ranking-grid__cell item-cell"><span class="breakdown-icon" data-item-id="${part.id}"></span>${itemDisplayName(data.items, part.id, locale)} &times;${Number.isInteger(part.qty) ? formatThousands(part.qty) : formatSignificant(part.qty)}</div>
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
 * Whether pushing past your weekly spend for the next tiers pays off. Starting point: your weekly
 * plan with the track running; tiers it already reaches are marked as such (no step). Each further
 * tier: the weekly plan at the tier's total spend minus the plan of the step before (your weekly
 * plan for the first one), i.e. the best packs the extra Banknotes still buy plus the tier reward,
 * in Banknotes at your weekly spend. Ratio = that ÷ the step's Banknotes: at least 1 = the step is
 * as good as your last Banknote at your weekly spend.
 */
function stepAnalysis(track, trackId) {
    const activeTrackIds = new Set([trackId]);
    const reachedTier = (plan, tier) =>
        plan.trackTiersReached.some((r) => r.trackId === trackId && r.threshold === tier.threshold);
    // The plan at about the threshold's worth of Banknotes (track points per Banknote ~1, rounded down by
    // the pack prices), at least `floor`, a little more if the packs on sale can't quite reach it.
    const solveTier = (tier, floor) => {
        let budget = Math.max(floor, tier.cumulativeCost, trackPointsBudget(track, tier.threshold));
        let plan = null;
        for (let attempt = 0; attempt < 4; attempt++) {
            plan = solveWeeklyPlan(valuation.highs, data, planOptions(data, settings, { budget, activeTrackIds }));
            if (reachedTier(plan, tier)) {
                break;
            }
            budget = Math.ceil(budget * 1.02);
        }
        return plan;
    };
    const base = solveWeeklyPlan(valuation.highs, data, planOptions(data, settings, { activeTrackIds }));
    let previousPoints = base.totalPoints;
    let previousSpent = base.spent;
    // Tiers your weekly spend already reaches still show what each takes on its own (total spend and step
    // ratio from the tier before, the first one from 0).
    let reachedPoints = 0;
    let reachedSpent = 0;
    return trackTiers(track).map((tier) => {
        const reward = valuation.bundle({ contains: tier.rewards }, 0);
        if (reachedTier(base, tier)) {
            const plan = solveTier(tier, 0);
            const stepCost = plan.spent - reachedSpent;
            const stepWorth = (plan.totalPoints - reachedPoints) / valuation.rate;
            reachedPoints = plan.totalPoints;
            reachedSpent = plan.spent;
            return {
                ...tier,
                cumulativeCost: plan.spent,
                stepCost,
                reward,
                reached: true,
                atWeeklySpend: true,
                stepWorth,
                packsWorth: stepWorth - reward.worth,
                ratio: stepCost > 0 ? stepWorth / stepCost : null,
            };
        }
        const plan = solveTier(tier, settings.budget);
        const stepCost = plan.spent - previousSpent;
        const stepWorth = (plan.totalPoints - previousPoints) / valuation.rate;
        previousPoints = plan.totalPoints;
        previousSpent = plan.spent;
        const reached = reachedTier(plan, tier);
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
    const trackId = trackPicker.getValue();
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
    // Only tiers beyond your weekly spend count for "spending more pays off up to …".
    const lastWorthIt = tiers.reduce(
        (last, tier, index) => (!tier.atWeeklySpend && tier.ratio >= 1 ? index : last),
        -1,
    );
    const reachedCount = tiers.filter((tier) => tier.atWeeklySpend).length;
    const reachedText =
        reachedCount > 0
            ? `${t('spendRewards.reachedSummary', { budget: formatThousands(settings.budget, 0), tier: reachedCount })} `
            : '';
    let verdict;
    if (reachedCount === tiers.length) {
        verdict = t('spendRewards.verdictAll');
    } else if (lastWorthIt >= 0) {
        verdict =
            reachedText +
            t('spendRewards.verdict', {
                tier: lastWorthIt + 1,
                total: formatThousands(tiers[lastWorthIt].cumulativeCost, 0),
            });
    } else {
        verdict = reachedText + t('spendRewards.verdictNone');
    }
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
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${tier.atWeeklySpend ? `<span class="text-dim nowrap">${t('spendRewards.reachedAtSpend')}</span>` : gold(formatThousands(tier.stepCost, 0))}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${gold(formatThousands(tier.packsWorth, 0))}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${tier.reached ? gold(formatThousands(tier.reward.worth, 0)) : `<span class="text-dim">${t('spendRewards.notReached')}</span>`}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">
                        ${tier.ratio === null || tier.ratio === undefined ? t('common.dash') : ratioBarHtml(tier.ratio, maxRatio, { digits: 3 })}
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

/** The spend reward tracks (one group); keeps the current selection. */
function populateTrackSelect() {
    trackPicker.setItems(
        Object.fromEntries(
            Object.entries(data.spend_reward_tracks || {}).map(([id, track]) => [
                id,
                { name: track.name, category: 'spend_track' },
            ]),
        ),
    );
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
