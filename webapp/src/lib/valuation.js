/**
 * The one worth model of the pages: the weekly-budget plan (planner.js, HiGHS loaded on demand)
 * on top of the deal % fit (point-fit.js), with the user's item priorities as weights.
 *
 * Worth of an item = its points ÷ the points your last Banknote buys at your weekly spend
 * (diamonds and event coins: what one more unit could still buy this week). `bundle(contents,
 * price)` values a package / reward bundle as `{ points, worth, ratio, incomplete, parts, picked }`
 * where ratio = worth ÷ price: 1.0 or more = worth buying at your weekly spend.
 */
import { fitItemPoints } from './point-fit.js';
import { solveWeeklyPlan } from './planner.js';
import { loadBrowserHighs } from './highs-browser';
import { priorityWeights } from './settings';
import { t } from './i18n';
import { formatThousands } from './format';

let fitCache = { data: null, fit: null };

/** The deal % fit (cached: it only changes with the data). */
function pointFit(data) {
    if (fitCache.data !== data) {
        fitCache = { data, fit: fitItemPoints(data) };
    }
    return fitCache.fit;
}

/** Solver options for the weekly plan of `settings` (also used for what-if budgets). */
function planOptions(data, settings, overrides = {}) {
    return {
        budget: settings.budget,
        activeEventIds: new Set(settings.activeEvents),
        seasonalPass: settings.seasonalPass,
        includePasses: true,
        includeExclusives: false,
        weights: priorityWeights(settings),
        basePoints: pointFit(data).points,
        ...overrides,
    };
}

/** `overrides`: extra planner options for a what-if valuation (e.g. the Events page's exceeded pack limits). */
async function buildValuation(data, settings, overrides = {}) {
    const fit = pointFit(data);
    const highs = await loadBrowserHighs();
    const plan = solveWeeklyPlan(highs, data, planOptions(data, settings, overrides));

    function points(itemId) {
        if (plan.mu.has(itemId)) {
            return plan.mu.get(itemId);
        }
        const value = plan.values.get(itemId)?.value;
        return Number.isFinite(value) ? value : null;
    }

    function bundle(contents, price) {
        const b = plan.bundlePoints(contents);
        const worth = b.value / plan.rate;
        return { ...b, points: b.value, worth, ratio: price > 0 ? worth / price : null };
    }

    return { fit, plan, highs, rate: plan.rate, points, worth: (itemId) => plan.worth(itemId), bundle };
}

/** One-line explanation of how points become Banknotes at the user's weekly spend. */
function modelSummaryText(valuation) {
    const plan = valuation.plan;
    const vars = {
        budget: formatThousands(plan.budget, 0),
        spent: formatThousands(plan.spent, 0),
        rate: formatThousands(plan.rate, 2),
    };
    return plan.budgetBinding ? t('valuation.summary', vars) : t('valuation.summaryUnbound', vars);
}

export { buildValuation, modelSummaryText, planOptions };
