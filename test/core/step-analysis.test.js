import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseEventSteps, analyseTrackTiers, eventPackSpend } from '../../webapp/src/core/step-analysis.js';
import { cheapestEventPackPrice, eventMaxSpend } from '../../webapp/src/core/catalog.js';
import { solveWeeklyPlan } from '../../webapp/src/core/planner.js';
import { trackTiers } from '../../webapp/src/core/spend-tracks.js';
import { DEFAULT_SETTINGS } from '../../webapp/src/core/settings-model.js';
import { loadSetup, expectGolden, defaultPlanOptions } from '../helpers.js';

const { data, highs, fit } = await loadSetup();

test('spend steps of an event: the plan solved again at higher spends', () => {
    const eventId = 'strange_bazaar';
    const options = defaultPlanOptions(fit, { activeEventIds: new Set([eventId]) });
    const solve = (overrides) => solveWeeklyPlan(highs, data, { ...options, ...overrides });
    const base = solve({});
    const steps = analyseEventSteps({
        eventId,
        base,
        rate: base.rate,
        maxSpend: eventMaxSpend(data.packages, eventId),
        cheapestPrice: cheapestEventPackPrice(data.packages, eventId),
        budget: DEFAULT_SETTINGS.budget,
        extraBanknotes: 0,
        solve,
    });

    assert.ok(steps.length >= 2, 'at least no spend and the plan');
    assert.deepEqual([steps[0].stepCost, steps[0].stepWorth, steps[0].ratio], [null, null, null]);
    assert.equal(steps[0].eventSpend, 0, 'the first step spends nothing on the event');
    assert.equal(steps.filter((step) => step.isPlan).length, 1, 'exactly one step is the plan itself');
    assert.equal(steps.find((step) => step.isPlan).eventSpend, eventPackSpend(base, eventId));
    for (let i = 1; i < steps.length; i += 1) {
        assert.ok(steps[i].eventSpend > steps[i - 1].eventSpend, 'each step spends more on the event');
        assert.ok(steps[i].stepCost > 0, 'and costs something');
    }
    expectGolden(
        'step-analysis-event',
        steps.map((step) => ({
            ...step,
            packs: new Map(step.packs.map(({ pkg, count }) => [pkg.name.en, count])),
        })),
    );
});

test('spend steps of a spend reward track: tier by tier from the weekly plan', () => {
    const trackId = 'ancient_recipe_antitoxin';
    const track = data.spend_reward_tracks[trackId];
    const options = defaultPlanOptions(fit);
    const solve = (overrides) => solveWeeklyPlan(highs, data, { ...options, ...overrides });
    const probe = solve({ activeTrackIds: new Set([trackId]) });
    const tiers = analyseTrackTiers({
        track,
        trackId,
        rate: probe.rate,
        budget: DEFAULT_SETTINGS.budget,
        rewardOf: (tier) => ({ worth: probe.bundlePoints({ contains: tier.rewards }).value / probe.rate }),
        solve,
    });

    assert.equal(tiers.length, trackTiers(track).length, 'one entry per tier');
    assert.deepEqual(
        tiers.map((tier) => tier.threshold),
        trackTiers(track).map((tier) => tier.threshold),
    );
    for (const tier of tiers) {
        assert.equal(typeof tier.reached, 'boolean');
        assert.ok(tier.reward.worth >= 0);
        assert.ok(tier.ratio === null || Number.isFinite(tier.ratio));
    }
    // The tiers the weekly spend reaches come first, marked as such.
    const flags = tiers.map((tier) => Boolean(tier.atWeeklySpend));
    assert.deepEqual(
        flags,
        [...flags].sort((a, b) => b - a),
    );
    expectGolden(
        'step-analysis-track',
        tiers.map((tier) => Object.fromEntries(Object.entries(tier).filter(([key]) => key !== 'rewards'))),
    );
});
