import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_NONE_ITEMS,
    DEFAULT_SETTINGS,
    planOptions,
    priorityWeights,
    zeroFitItems,
} from '../../webapp/src/core/settings-model.js';

test('VIP points are left out of the fit unless the setting counts them', () => {
    assert.deepEqual(zeroFitItems(DEFAULT_SETTINGS), ['vip_points']);
    assert.deepEqual(zeroFitItems({ ...DEFAULT_SETTINGS, vipPointsInWorth: true }), []);
});

test('priorities become factors on the worth; "normal" and unknown levels count 1', () => {
    const settings = { priorities: { a: 'none', b: 'low', c: 'normal', d: 'high', e: 'whatever' } };
    assert.deepEqual(priorityWeights(settings), { a: 0, b: 0.5, c: 1, d: 2, e: 1 });
    assert.deepEqual(priorityWeights({}), {});
});

test('the defaults put the items players do not care about at "Don\'t care"', () => {
    assert.deepEqual(Object.keys(DEFAULT_SETTINGS.priorities), DEFAULT_NONE_ITEMS);
    assert.ok(Object.values(DEFAULT_SETTINGS.priorities).every((level) => level === 'none'));
    assert.equal(priorityWeights(DEFAULT_SETTINGS).vip_points, 0);
});

test('plan options: the settings as the solver reads them, overrides winning', () => {
    const settings = {
        ...DEFAULT_SETTINGS,
        budget: 5000,
        activeEvents: ['bazaar'],
        seasonalPasses: ['gear_pass'],
        lockedOffers: { 'shop:offer': 2 },
        extraCurrency: { diamonds: 100 },
        // One skip still on today (day 60), one over.
        skippedPackages: { still_skipped: 100, over: 50 },
    };
    const basePoints = new Map([['gem', { value: 3 }]]);
    const options = planOptions(settings, { today: 60, basePoints });
    assert.equal(options.budget, 5000);
    assert.deepEqual([...options.activeEventIds], ['bazaar']);
    assert.deepEqual(options.seasonalPasses, ['gear_pass']);
    assert.deepEqual(options.lockedOffers, { 'shop:offer': 2 });
    assert.deepEqual(options.skippedPackages, ['still_skipped']);
    assert.deepEqual(options.extraCurrency, { diamonds: 100 });
    assert.equal(options.includePasses, true);
    assert.equal(options.includeExclusives, false);
    assert.equal(options.weights.vip_points, 0);
    assert.equal(options.basePoints, basePoints);

    const what = planOptions(settings, { today: 60, basePoints }, { budget: 1, skippedPackages: [] });
    assert.equal(what.budget, 1);
    assert.deepEqual(what.skippedPackages, []);
    assert.equal(what.includePasses, true);
});
