/**
 * The one worth model of the pages: the weekly-budget plan (planner.js, HiGHS loaded on demand)
 * on top of the deal % fit (point-fit.js), with the user's item priorities as weights.
 *
 * Worth of an item = its points ÷ the points your last Banknote buys at your weekly spend
 * (diamonds and event coins: what one more unit could still buy this week). `bundle(contents,
 * price)` values a package / reward bundle as `{ points, worth, ratio, incomplete, parts, picked }`
 * where ratio = worth ÷ price: 1.0 or more = worth buying at your weekly spend.
 */
import { fitItemPoints } from '../core/point-fit.js';
import { solveWeeklyPlan } from '../core/planner.js';
import { loadBrowserHighs } from './highs-browser.js';
import { priorityWeights, zeroFitItems } from './settings.js';
import { t } from './i18n.js';
import { formatThousands } from './format.js';

let fitCache = { data: null, key: null, fit: null };

/** The deal % fit (cached: it only changes with the data and the items the settings leave out, see zeroFitItems). */
function pointFit(data, settings) {
    const zeroItems = zeroFitItems(settings);
    const key = zeroItems.join(',');
    if (fitCache.data !== data || fitCache.key !== key) {
        fitCache = { data, key, fit: fitItemPoints(data, { zeroItems: new Set(zeroItems) }) };
    }
    return fitCache.fit;
}

/** Solver options for the weekly plan of `settings` (also used for what-if budgets). */
function planOptions(data, settings, overrides = {}) {
    return {
        budget: settings.budget,
        activeEventIds: new Set(settings.activeEvents),
        seasonalPasses: settings.seasonalPasses,
        // "Must buy" shop offers shape the one plan on every page.
        lockedOffers: settings.lockedOffers,
        // Currency from outside the packs ("Extra ... per week" of a shop without event, Events page).
        extraCurrency: settings.extraCurrency,
        includePasses: true,
        includeExclusives: false,
        weights: priorityWeights(settings),
        basePoints: pointFit(data, settings).points,
        ...overrides,
    };
}

/** `overrides`: extra planner options for a what-if valuation (e.g. the Events page's exceeded pack limits). */
async function buildValuation(data, settings, overrides = {}) {
    const fit = pointFit(data, settings);
    const highs = await loadBrowserHighs();
    const plan = solveWeeklyPlan(highs, data, planOptions(data, settings, overrides));

    // Currencies at their marginal value, also inside items that open into them (planner.js `itemPoints`).
    const points = (itemId) => plan.itemPoints(itemId);

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

export { buildValuation, modelSummaryText, planOptions, pointFit };
