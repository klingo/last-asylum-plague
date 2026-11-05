/**
 * "Is spending more worth it?": the weekly plan (planner.js) solved again at higher spends, step by step, for an
 * event's packs (Event Shops) and for the tiers of a spend reward track (Spend Rewards). A step's ratio is what its
 * extra Banknotes buy, in Banknotes at the user's weekly spend, ÷ those Banknotes: at least 1 = the step is as good as
 * the last Banknote of the weekly spend.
 *
 * The caller passes `solve(overrides)`: the plan with the page's settings and `overrides` on top (planOptions), and
 * the plan it already shows (`base`) with its `rate`. Pure module (no DOM/i18n), shared with the tests.
 */
import { trackPointsForPrice, trackTiers } from './spend-tracks.js';

// Event pack spend levels of the "how much to spend" table (beyond what the plan already spends).
const EVENT_SPEND_LEVELS = [1000, 2000, 5000, 10000, 20000, 50000];

/** The plan's purchases of the event's packages. */
const eventPurchases = (plan, eventId) => plan.purchases.filter((p) => p.pkg.event_id === eventId);

/** Banknotes the plan spends on the event's packages. */
const eventPackSpend = (plan, eventId) => eventPurchases(plan, eventId).reduce((sum, p) => sum + p.spend, 0);

/** What the step from the plan `previous` (`{ spent, totalPoints }`) to `plan` costs and is worth at `rate`. */
function stepBetween(previous, plan, rate) {
    const stepCost = plan.spent - previous.spent;
    const stepWorth = (plan.totalPoints - previous.totalPoints) / rate;
    return { stepCost, stepWorth, ratio: stepCost > 0 ? stepWorth / stepCost : null };
}

/**
 * How much spending on the event is worth it: the weekly plan re-solved with the event's pack spend at 0, at the
 * plan's own spend E₀ and at round levels above it, the rest of the weekly spend unchanged (budget = weekly spend +
 * the event's extra Banknotes − E₀ + level). Above E₀ a level only has to be reached within one cheapest pack (whole
 * packs rarely hit it exactly); levels the event can't reach, or that change nothing, are left out.
 * `{ eventId, base, rate, maxSpend, cheapestPrice, budget, extraBanknotes, solve }`: `maxSpend` the most the event's
 * packages can take, `cheapestPrice` its cheapest pack, `budget` the weekly spend, `extraBanknotes` the event's own.
 * Returns `[{ isPlan, eventSpend, packs: [{ pkg, count }], stepCost, stepWorth, ratio }]` (cost and worth null for the
 * first step).
 */
function analyseEventSteps({ eventId, base, rate, maxSpend, cheapestPrice, budget, extraBanknotes, solve }) {
    const e0 = eventPackSpend(base, eventId);
    const levels = [...new Set([0, e0, ...EVENT_SPEND_LEVELS.filter((level) => level > e0 && level <= maxSpend)])].sort(
        (a, b) => a - b,
    );
    const slack = cheapestPrice - 1;
    const solveLevel = (level) => {
        if (level === e0) {
            return base;
        }
        try {
            return solve({
                // The level pins the event's spend; the extra Banknotes are part of the total here.
                eventBudget: null,
                budget: budget + extraBanknotes - e0 + level,
                eventSpend: level < e0 ? { eventId, max: level } : { eventId, min: Math.max(e0, level - slack) },
            });
        } catch {
            return null; // level out of reach
        }
    };
    let previous = null;
    const steps = [];
    for (const level of levels) {
        const plan = solveLevel(level);
        if (!plan || (previous && eventPackSpend(plan, eventId) === eventPackSpend(previous, eventId))) {
            continue;
        }
        steps.push({
            isPlan: level === e0,
            eventSpend: eventPackSpend(plan, eventId),
            packs: eventPurchases(plan, eventId).map((p) => ({ pkg: p.pkg, count: p.count })),
            ...(previous ? stepBetween(previous, plan, rate) : { stepCost: null, stepWorth: null, ratio: null }),
        });
        previous = plan;
    }
    return steps;
}

/** Banknotes that earn `points` track points at the track's typical rate. */
function trackPointsBudget(track, points) {
    const perBanknote = trackPointsForPrice(track, 1000) / 1000;
    return Math.ceil(points / perBanknote);
}

/**
 * Whether pushing past the weekly spend for the next tiers pays off. Starting point: the weekly plan with the track
 * running; tiers it already reaches are marked as such (no step). Each further tier: the weekly plan at the tier's
 * total spend minus the plan of the step before (the weekly plan for the first one), i.e. the best packs the extra
 * Banknotes still buy plus the tier reward, in Banknotes at the weekly spend.
 * `{ track, trackId, rate, budget, rewardOf, solve }`: `rewardOf(tier)` values a tier's reward (`{ worth }`),
 * `budget` is the weekly spend, `solve` gets `{ budget?, activeTrackIds }`.
 * Returns the tiers (`trackTiers`) with `cumulativeCost`, `stepCost`, `reward`, `reached`, `stepWorth`,
 * `packsWorth` and `ratio` (and `atWeeklySpend` for a tier the weekly spend reaches).
 */
function analyseTrackTiers({ track, trackId, rate, budget, rewardOf, solve }) {
    const activeTrackIds = new Set([trackId]);
    const reachedTier = (plan, tier) =>
        plan.trackTiersReached.some((r) => r.trackId === trackId && r.threshold === tier.threshold);
    // The plan at about the threshold's worth of Banknotes (track points per Banknote ~1, rounded down by
    // the pack prices), at least `floor`, a little more if the packs on sale can't quite reach it.
    const solveTier = (tier, floor) => {
        let tierBudget = Math.max(floor, tier.cumulativeCost, trackPointsBudget(track, tier.threshold));
        let plan = null;
        for (let attempt = 0; attempt < 4; attempt++) {
            plan = solve({ budget: tierBudget, activeTrackIds });
            if (reachedTier(plan, tier)) {
                break;
            }
            tierBudget = Math.ceil(tierBudget * 1.02);
        }
        return plan;
    };
    const base = solve({ activeTrackIds });
    let previous = { spent: base.spent, totalPoints: base.totalPoints };
    // Tiers the weekly spend already reaches still show what each takes on its own (total spend and step
    // ratio from the tier before, the first one from 0).
    let reachedBefore = { spent: 0, totalPoints: 0 };
    return trackTiers(track).map((tier) => {
        const reward = rewardOf(tier);
        if (reachedTier(base, tier)) {
            const plan = solveTier(tier, 0);
            const step = stepBetween(reachedBefore, plan, rate);
            reachedBefore = { spent: plan.spent, totalPoints: plan.totalPoints };
            return {
                ...tier,
                cumulativeCost: plan.spent,
                stepCost: step.stepCost,
                reward,
                reached: true,
                atWeeklySpend: true,
                stepWorth: step.stepWorth,
                packsWorth: step.stepWorth - reward.worth,
                ratio: step.ratio,
            };
        }
        const plan = solveTier(tier, budget);
        const step = stepBetween(previous, plan, rate);
        previous = { spent: plan.spent, totalPoints: plan.totalPoints };
        const reached = reachedTier(plan, tier);
        return {
            ...tier,
            cumulativeCost: plan.spent,
            stepCost: step.stepCost,
            reward,
            reached,
            stepWorth: step.stepWorth,
            packsWorth: step.stepWorth - (reached ? reward.worth : 0),
            ratio: step.ratio,
        };
    });
}

export { analyseEventSteps, analyseTrackTiers, eventPackSpend, eventPurchases };
