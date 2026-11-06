/**
 * Spend Rewards: pick a spend reward track (`?track=`; the one running today is pre-selected) to see its banner and
 * when it runs and, per tier (`trackTiers`, core/spend-tracks.js), what the extra Banknotes buy (the weekly plan solved
 * again at that total spend) plus the tier's reward, as a step ratio: spend more while it is 1.0 or more.
 */
import { startPage } from '../ui/page.js';
import { planOptions } from '../ui/valuation.js';
import { urlParam, setUrlParams } from '../ui/url.js';
import { solveWeeklyPlan } from '../core/planner.js';
import { mountValuationPage } from '../ui/valuation-page.js';
import { getSettings } from '../ui/settings.js';
import { withLoading } from '../ui/loading.js';
import { analyseTrackTiers } from '../core/step-analysis.js';
import { gameDay, runContains, scheduleRuns } from '../core/schedule.js';
import { banknotesAmount, hydrateItemIcons } from '../ui/html.js';
import {
    gridCell,
    gridNum,
    gridHeader,
    gridRow,
    gridTable,
    gridDetails,
    detailsToggleHtml,
    wireDetailsToggles,
    breakdownParts,
} from '../ui/grid.js';
import { localizedName, t, tHtml } from '../ui/i18n.js';
import { formatThousands } from '../ui/format.js';
import { ratioCellHtml, ratioScale } from '../ui/ratio-bar.js';
import { createItemPicker } from '../ui/item-picker.js';
import { mountBanner } from '../ui/event-banner.js';

const trackBanner = document.getElementById('track-banner');
const tiersPrompt = document.getElementById('tiers-prompt');
const tiersEmpty = document.getElementById('tiers-empty');
const tiersWrap = document.getElementById('tiers-wrap');
const tiersTable = document.getElementById('tiers-table');
const tiersNote = document.getElementById('tiers-note');

let data = null;
let trackPicker = null;
let valuation = null;
let recompute = null;
const expandedKeys = new Set();

/** The Details block of a tier: its reward's contents in the table's columns. */
function detailsHtml(key, tier) {
    // The tier table's Step cost, Packs and Reward worth columns are hidden on phones (the three after Category). The
    // Category column then shows the item's worth, in the place of the Total spend column above it.
    const header = gridRow([
        gridHeader(tHtml('common.table.item')),
        gridHeader(
            `<span class="wide-only">${tHtml('common.table.category')}</span><span class="phone-only">${tHtml('common.table.worth')}</span>`,
        ),
        gridHeader(tHtml('common.table.worthEach'), { num: true, wide: true }),
        gridHeader(tHtml('common.table.worth'), { num: true, wide: true }),
        gridHeader('', { wide: true }),
        gridHeader(),
        gridHeader(),
    ]);
    const rows = breakdownParts(tier.reward.parts, data, valuation).map((part) =>
        gridRow([
            gridCell(part.item, { className: 'item-cell' }),
            gridCell(`<span class="wide-only">${part.category}</span><span class="phone-only">${part.worth}</span>`),
            gridNum(part.worthEach, { wide: true }),
            gridNum(part.worth, { wide: true }),
            gridCell('', { wide: true }),
            gridCell(part.incomplete),
            gridCell(),
        ]),
    );
    return gridDetails(key, expandedKeys, header + rows.join(''));
}

/** Whether pushing past the weekly spend for the next tiers pays off (step-analysis.js `analyseTrackTiers`). */
function stepAnalysis(track, trackId) {
    return analyseTrackTiers({
        track,
        trackId,
        rate: valuation.rate,
        budget: getSettings().budget,
        rewardOf: (tier) => valuation.bundle({ contains: tier.rewards }, 0),
        solve: (overrides) => solveWeeklyPlan(valuation.highs, data, planOptions(data, getSettings(), overrides)),
    });
}

let stepCache = { key: null, tiers: null };

function render() {
    const trackId = trackPicker.getValue();
    const track = data.spend_reward_tracks?.[trackId];
    tiersPrompt.hidden = Boolean(track);
    // The track's art and when it runs: its tiers only count while it does.
    mountBanner(trackBanner, data, trackId, track && { image: track.image, name: localizedName(track.name) }, render);
    if (!track) {
        tiersWrap.hidden = true;
        tiersNote.hidden = true;
        tiersEmpty.hidden = true;
        return;
    }
    const usesPoints = Array.isArray(track.conversions) && track.conversions.length > 0;
    const cacheKey = `${trackId}|${JSON.stringify(getSettings())}`;
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
            ? `${t('spendRewards.reachedSummary', { budget: formatThousands(getSettings().budget, 0), tier: reachedCount })} `
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
    tiersNote.textContent = `${verdict} ${t('spendRewards.note')}`;

    const maxRatio = ratioScale(tiers.map((tier) => tier.ratio));
    const rows = tiers
        .map((tier, index) => {
            const key = `${trackId}:${tier.threshold}`;
            const label = t('spendRewards.tierLabel', { tier: index + 1 });
            const row = gridRow([
                gridCell(
                    usesPoints
                        ? `${label} (${formatThousands(tier.threshold)}&nbsp;${tHtml('spendRewards.pointsSuffix')})`
                        : label,
                ),
                gridNum(banknotesAmount(tier.cumulativeCost)),
                gridNum(
                    tier.atWeeklySpend
                        ? `<span class="text-dim nowrap">${tHtml('spendRewards.reachedAtSpend')}</span>`
                        : banknotesAmount(tier.stepCost),
                    { wide: true },
                ),
                gridNum(banknotesAmount(tier.packsWorth), { wide: true }),
                gridNum(
                    tier.reached
                        ? banknotesAmount(tier.reward.worth)
                        : `<span class="text-dim">${tHtml('spendRewards.notReached')}</span>`,
                    { wide: true },
                ),
                gridNum(ratioCellHtml(tier.ratio, maxRatio)),
                gridCell(detailsToggleHtml(key, expandedKeys)),
            ]);
            return row + detailsHtml(key, tier);
        })
        .join('');

    const header = gridRow([
        gridHeader(tHtml('spendRewards.table.tier')),
        gridHeader(tHtml('spendRewards.table.threshold'), { num: true }),
        gridHeader(tHtml('spendRewards.table.stepCost'), { num: true, wide: true }),
        gridHeader(tHtml('spendRewards.table.packs'), { num: true, wide: true }),
        gridHeader(tHtml('spendRewards.table.worth'), { num: true, wide: true }),
        gridHeader(tHtml('spendRewards.table.ratio'), { num: true }),
        gridHeader(),
    ]);
    tiersTable.innerHTML = gridTable(header, rows);
    hydrateItemIcons(tiersTable);
    wireDetailsToggles(tiersTable, expandedKeys);
}

/** The spend reward tracks the schedule shows running today (the game day). */
function runningTrackIds() {
    const today = gameDay(new Date()).day;
    return [...scheduleRuns(data, today)]
        .filter(
            ([id, { kind, runs }]) =>
                kind === 'track' && data.spend_reward_tracks?.[id] && runs.some((run) => runContains(run, today)),
        )
        .map(([id]) => id);
}

/** The spend reward tracks (one group), the ones running today with a green dot; keeps the current selection. */
function populateTrackSelect() {
    const running = new Set(runningTrackIds());
    trackPicker.setItems(
        Object.fromEntries(
            Object.entries(data.spend_reward_tracks || {}).map(([id, track]) => [
                id,
                { name: track.name, category: 'spend_track', now: running.has(id) },
            ]),
        ),
    );
}

startPage('spend-rewards', {
    async init(loaded) {
        data = loaded;
        // The app's own picker (as on the other pages), not a native <select>.
        trackPicker = createItemPicker({
            trigger: document.getElementById('track-select'),
            placeholderKey: 'spendRewards.trackPlaceholder',
            searchPlaceholderKey: 'spendRewards.trackSearch',
            icons: false,
            onChange: () => {
                expandedKeys.clear();
                setUrlParams({ track: trackPicker.getValue() });
                void withLoading(render);
            },
        });
        ({ recompute } = mountValuationPage(data, {
            fields: ['budget', 'events', 'passes'],
            render: (next) => {
                valuation = next;
                render();
            },
        }));
        populateTrackSelect();
        // Pre-select the track running today (the first, should there be several); a track in the URL (a shared
        // link, a reload) wins over today's.
        const [running] = runningTrackIds();
        const fromUrl = urlParam('track');
        if (fromUrl && data.spend_reward_tracks?.[fromUrl]) {
            trackPicker.setValue(fromUrl);
        } else if (running) {
            trackPicker.setValue(running);
        }
        await recompute();
    },
    onLocaleChange() {
        populateTrackSelect();
        render();
    },
});
