import { startPage } from '../ui/page.js';
import { buildValuation, modelSummaryText, planOptions } from '../ui/valuation.js';
import { solveWeeklyPlan } from '../core/planner.js';
import { mountValuationPanel } from '../ui/valuation-panel.js';
import { getSettings, onSettingsChange } from '../ui/settings.js';
import { withLoading } from '../ui/loading.js';
import { trackTiers, trackPointsForPrice } from '../core/spend-tracks.js';
import { localDayNumber, scheduleRuns } from '../core/schedule.js';
import { banknotesHtml, hydrateItemIcons } from '../ui/html.js';
import {
    gridCell,
    gridNum,
    gridHeader,
    gridRow,
    gridDetails,
    detailsToggleHtml,
    wireDetailsToggles,
    breakdownParts,
} from '../ui/grid.js';
import { t } from '../ui/i18n.js';
import { formatThousands } from '../ui/format.js';
import { ratioBarHtml } from '../ui/ratio-bar.js';
import { createItemPicker } from '../ui/item-picker.js';

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

/** The Details block of a tier: its reward's contents in the table's columns. */
function detailsHtml(key, tier) {
    const header = gridRow([
        gridHeader(t('spendRewards.table.item')),
        gridHeader(t('rankings.table.category')),
        gridHeader(t('rankings.table.pointsEach'), { num: true }),
        gridHeader(t('rankings.table.worth'), { num: true }),
        gridHeader(),
        gridHeader(),
        gridHeader(),
    ]);
    const rows = breakdownParts(tier.reward.parts, data, valuation).map((part) =>
        gridRow([
            gridCell(part.item, { className: 'item-cell' }),
            gridCell(part.category),
            gridNum(part.points),
            gridNum(part.worth),
            gridCell(),
            gridCell(part.unknown ? `<span class="text-bad">${t('rankings.table.incomplete')}</span>` : ''),
            gridCell(),
        ]),
    );
    return gridDetails(key, expandedKeys, header + rows.join(''));
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
    const tiers = stepCache.tiers;
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
            const row = gridRow([
                gridCell(
                    usesPoints
                        ? `${label} (<span class="text-gold">${formatThousands(tier.threshold)}</span>&nbsp;${t('spendRewards.pointsSuffix')})`
                        : label,
                ),
                gridNum(banknotesHtml(formatThousands(tier.cumulativeCost, 0))),
                gridNum(
                    tier.atWeeklySpend
                        ? `<span class="text-dim nowrap">${t('spendRewards.reachedAtSpend')}</span>`
                        : banknotesHtml(formatThousands(tier.stepCost, 0)),
                ),
                gridNum(banknotesHtml(formatThousands(tier.packsWorth, 0))),
                gridNum(
                    tier.reached
                        ? banknotesHtml(formatThousands(tier.reward.worth, 0))
                        : `<span class="text-dim">${t('spendRewards.notReached')}</span>`,
                ),
                gridNum(
                    tier.ratio === null || tier.ratio === undefined
                        ? t('common.dash')
                        : ratioBarHtml(tier.ratio, maxRatio, { digits: 3 }),
                ),
                gridCell(detailsToggleHtml(key, expandedKeys)),
            ]);
            return row + detailsHtml(key, tier);
        })
        .join('');

    const header = gridRow([
        gridHeader(t('spendRewards.table.tier')),
        gridHeader(t('spendRewards.table.threshold'), { num: true }),
        gridHeader(t('spendRewards.table.stepCost'), { num: true }),
        gridHeader(t('spendRewards.table.packs'), { num: true }),
        gridHeader(t('spendRewards.table.worth'), { num: true }),
        gridHeader(t('spendRewards.table.ratio'), { num: true }),
        gridHeader(),
    ]);
    tiersTable.innerHTML = header + rows;
    hydrateItemIcons(tiersTable);
    wireDetailsToggles(tiersTable, expandedKeys);
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

startPage('spend-rewards', {
    async init(loaded) {
        data = loaded;
        settings = getSettings();
        mountValuationPanel(document.getElementById('valuation-panel'), data, {
            fields: ['budget', 'events', 'passes'],
        });
        onSettingsChange((next) => {
            settings = next;
            recompute();
        });
        populateTrackSelect();
        // Pre-select the track running today according to the recorded schedule (the first, should there be several).
        const today = localDayNumber(new Date());
        const running = [...scheduleRuns(data)].find(
            ([id, { kind, runs }]) =>
                kind === 'track' &&
                data.spend_reward_tracks?.[id] &&
                runs.some((run) => run.start <= today && today <= run.end),
        );
        if (running) {
            trackPicker.setValue(running[0]);
        }
        await recompute();
    },
    onLocaleChange() {
        populateTrackSelect();
        render();
    },
});
