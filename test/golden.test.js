/**
 * Golden tests: the fit, the weekly plan (in the settings the pages use) and the Compare plan on the frozen
 * fixture. They pin today's numbers, so a refactor that changes any of them fails here.
 */
import { test } from 'node:test';
import { fitItemPoints, fitSensitivity } from '../webapp/src/core/point-fit.js';
import { solveWeeklyPlan } from '../webapp/src/core/planner.js';
import { solveNeeds } from '../webapp/src/core/acquire.js';
import { loadHighs } from '../webapp/src/core/lp.js';
import { DEFAULT_SETTINGS, priorityWeights } from '../webapp/src/ui/settings.js';
import { loadFixture, expectGolden } from './helpers.js';

const data = loadFixture();
const fit = fitItemPoints(data);
const highs = await loadHighs();

/** Planner options as valuation.js `planOptions` builds them from the default settings. */
function planOptions(overrides = {}) {
    return {
        budget: DEFAULT_SETTINGS.budget,
        activeEventIds: new Set(),
        seasonalPasses: [],
        lockedOffers: {},
        includePasses: true,
        includeExclusives: false,
        weights: priorityWeights(DEFAULT_SETTINGS),
        basePoints: fit.points,
        ...overrides,
    };
}

/** Everything the pages read from a weekly plan. */
function planSummary(plan) {
    return {
        rate: plan.rate,
        lambda: plan.lambda,
        budgetBinding: plan.budgetBinding,
        spent: plan.spent,
        totalPoints: plan.totalPoints,
        purchases: new Map(plan.purchases.map((p) => [p.id, p.count])),
        exchanges: new Map(plan.exchanges.map((e) => [`${e.shopId}:${e.offerKey}`, e.count])),
        tiersReached: plan.tiersReached.map((tier) => `${tier.shopId}:${tier.threshold}`).sort(),
        trackTiersReached: plan.trackTiersReached.map((tier) => `${tier.trackId}:${tier.threshold}`).sort(),
        pointPurchases: new Map(plan.pointPurchases.map((p) => [p.shopId, p.count])),
        lockShortfalls: plan.lockShortfalls,
        mu: plan.mu,
        currencies: plan.currencies,
        // Worth of every item and every package (the Ranking's numbers).
        itemWorth: new Map(Object.keys(data.items).map((id) => [id, plan.worth(id)])),
        packagePoints: new Map(Object.entries(data.packages).map(([id, pkg]) => [id, plan.bundlePoints(pkg).value])),
    };
}

test('deal % fit', () => {
    expectGolden('fit', {
        points: new Map(
            [...fit.points].map(([id, entry]) => [
                id,
                { value: entry.value, source: entry.source, uncertain: entry.uncertain ?? null },
            ]),
        ),
        diagnostics: { ...fit.diagnostics, packages: new Map(fit.diagnostics.packages.map((p) => [p.id, p.ratio])) },
    });
});

test('fit sensitivity (leave one pack family out)', () => {
    expectGolden('fit-sensitivity', fitSensitivity(data, fit));
});

const scenarios = {
    // Ranking, Items, Choices, ... with the default settings.
    'plan-default': {},
    // Budget so high that it isn't binding: the rate falls back to the weakest bought pack.
    'plan-unbound': { budget: 1000000 },
    // Events, a seasonal pass and a spend reward track running (Spend Rewards).
    'plan-events': {
        activeEventIds: new Set(['surprise_encounter', 'strange_bazaar', 'blades_out', 'full_moon_night']),
        seasonalPasses: ['gear_pass'],
        activeTrackIds: new Set(['ancient_recipe_antitoxin']),
    },
    // The Events page's what-ifs: exceeded limits, extra Banknotes / diamonds, locked offers.
    'plan-events-page': {
        activeEventIds: new Set(['surprise_encounter']),
        exceedEventPackLimits: new Set(['surprise_encounter']),
        eventBudget: { eventId: 'surprise_encounter', extra: 5000 },
        extraCurrency: { diamonds: 3000 },
        lockedOffers: {
            [`surprise_encounter_shop:${Object.keys(data.exchange_shops.surprise_encounter_shop.offers).sort()[0]}`]: 1,
        },
    },
    // The Events page's step table: a minimum spend on one event.
    'plan-event-spend': {
        activeEventIds: new Set(['strange_bazaar']),
        eventSpend: { eventId: 'strange_bazaar', min: 2000 },
    },
};

for (const [name, overrides] of Object.entries(scenarios)) {
    test(`weekly plan: ${name}`, () => {
        expectGolden(name, planSummary(solveWeeklyPlan(highs, data, planOptions(overrides))));
    });
}

/** "<kind>:<item>:<target or picked option>" -> count. */
function conversionCounts(conversions) {
    const counts = new Map();
    for (const c of conversions) {
        const detail = c.targetId ?? Object.keys(c.option ?? c.ingredients ?? {}).join('+');
        const key = `${c.kind}:${c.itemId}:${detail}`;
        counts.set(key, (counts.get(key) || 0) + c.count);
    }
    return counts;
}

test('cheapest plan for needs (Compare)', () => {
    const plan = solveWeeklyPlan(highs, data, planOptions());
    const needs = { raven_essence: 100, lv5_sharp_beak: 1, speedup: 10000, ur_hero_omni_shard: 20 };
    const results = {};
    for (const [itemId, amount] of Object.entries(needs)) {
        const result = solveNeeds(highs, data, new Map([[itemId, amount]]), {
            days: 7,
            startDay: 0,
            activeEventIds: new Set(),
            includeExclusives: false,
            seasonalPasses: [],
            worthOf: (id) => plan.worth(id) ?? 0,
        });
        results[itemId] = {
            reachable: result.reachable,
            totalCost: result.totalCost,
            byproductWorth: result.byproductWorth,
            packages: new Map(result.packages.map((p) => [p.id, p.count])),
            offers: new Map(result.offers.map((o) => [`${o.shopId}:${o.offerKey}`, o.count])),
            conversions: conversionCounts(result.conversions),
        };
    }
    expectGolden('needs', results);
});
