import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skipUntilDay, activeSkips, expandSkips } from '../webapp/src/core/skips.js';
import { weekdayIndex } from '../webapp/src/core/schedule.js';
import { solveWeeklyPlan } from '../webapp/src/core/planner.js';
import { fitItemPoints } from '../webapp/src/core/point-fit.js';
import { loadHighs } from '../webapp/src/core/lp.js';
import { DEFAULT_SETTINGS, priorityWeights } from '../webapp/src/ui/settings.js';
import { loadFixture } from './helpers.js';

// Game day numbers (days since 1970-01-01): 2026-11-02 is a Monday.
const MONDAY = Date.UTC(2026, 10, 2) / 86400000;
const day = (offset) => MONDAY + offset;
const iso = (offset) => new Date((MONDAY + offset) * 86400000).toISOString().slice(0, 10);

test('skips: the test days are what they say', () => {
    assert.equal(weekdayIndex(MONDAY), 0);
});

test('skips: a pack lasts until the weekly reset', () => {
    const data = { events: {}, schedule: {} };
    // Wednesday: the next Monday (day 7) is the first day it no longer applies; Monday itself too.
    assert.equal(skipUntilDay('daily_pack', {}, day(2), data), day(7));
    assert.equal(skipUntilDay('daily_pack', {}, day(0), data), day(7));
    assert.equal(skipUntilDay('daily_pack', {}, day(6), data), day(7), 'Sunday: the reset is the next day');
});

test('skips: an event pack lasts until its event ends if that is before the week does', () => {
    const data = {
        events: { bazaar: { category: 'special_event' } },
        schedule: { bazaar: [{ start: iso(-1), end: iso(3) }] },
    };
    const pkg = { event_id: 'bazaar' };
    assert.equal(skipUntilDay('bazaar_pack', pkg, day(1), data), day(4), 'the day after its last day');
});

test('skips: a run that outlasts the week still ends the skip at the week', () => {
    const data = {
        events: { bazaar: { category: 'special_event' } },
        schedule: { bazaar: [{ start: iso(-1), end: iso(12) }] },
    };
    assert.equal(skipUntilDay('bazaar_pack', { event_id: 'bazaar' }, day(1), data), day(7));
});

test('skips: a seasonal pass lasts until its run ends (by family)', () => {
    const data = { events: {}, schedule: { gear_pass: [{ start: iso(0), end: iso(2) }] } };
    const pkg = { seasonal: true, tier: 2 };
    assert.equal(skipUntilDay('gear_pass_t2', pkg, day(1), data), day(3));
});

test('skips: without a run containing today only the week counts', () => {
    const data = { events: {}, schedule: { gear_pass: [{ start: iso(-20), end: iso(-10) }] } };
    assert.equal(skipUntilDay('gear_pass_t1', { seasonal: true, tier: 1 }, day(1), data), day(7));
});

test('skips: only the ones not yet expired apply', () => {
    const skips = { a: day(3), b: day(1), c: day(2) };
    assert.deepEqual(activeSkips(skips, day(2)).sort(), ['a']);
    assert.deepEqual(activeSkips(skips, day(1)).sort(), ['a', 'c']);
    assert.deepEqual(activeSkips(undefined, day(1)), []);
});

test('skips: a skip carries up the ladder, never down', () => {
    const packages = {
        a_t1: {},
        a_t2: { requires: 'a_t1' },
        a_t3: { requires: 'a_t2' },
        a_t4: { requires: 'a_t2' },
        other: {},
    };
    assert.deepEqual(
        [...expandSkips(['a_t1'], packages)],
        [
            ['a_t1', 'a_t1'],
            ['a_t2', 'a_t1'],
            ['a_t3', 'a_t1'],
            ['a_t4', 'a_t1'],
        ],
        'tier 1 takes every tier above it, the cause is tier 1',
    );
    assert.deepEqual(
        [...expandSkips(['a_t2'], packages)],
        [
            ['a_t2', 'a_t2'],
            ['a_t3', 'a_t2'],
            ['a_t4', 'a_t2'],
        ],
        'tier 2 leaves tier 1 alone',
    );
    assert.equal(expandSkips(['a_t3'], packages).has('a_t4'), false, 'a sibling is not above it');
    assert.equal(expandSkips([], packages).size, 0);
});

test('skips: a package skipped itself and above a skipped one keeps itself as the cause', () => {
    const packages = { a_t1: {}, a_t2: { requires: 'a_t1' } };
    assert.equal(expandSkips(['a_t1', 'a_t2'], packages).get('a_t2'), 'a_t2');
});

// The planner on the frozen fixture: skipping a recommended pack plans without it and fills the spend up again.
const data = loadFixture();
const highs = await loadHighs();
const fit = fitItemPoints(data);
const planOptions = (overrides = {}) => ({
    budget: DEFAULT_SETTINGS.budget,
    activeEventIds: new Set(),
    seasonalPasses: [],
    lockedOffers: {},
    includePasses: true,
    includeExclusives: false,
    weights: priorityWeights(DEFAULT_SETTINGS),
    basePoints: fit.points,
    ...overrides,
});
const bought = (plan) => new Map(plan.purchases.map((purchase) => [purchase.id, purchase.count]));

test('skips: the plan without a skipped pack buys others and fills the spend up', () => {
    const base = solveWeeklyPlan(highs, data, planOptions());
    assert.ok(bought(base).has('hero_shard_t1'), 'the default plan buys it');
    const plan = solveWeeklyPlan(highs, data, planOptions({ skippedPackages: ['hero_shard_t1'] }));
    assert.equal(bought(plan).has('hero_shard_t1'), false, 'skipped');
    assert.ok(plan.spent > 0.9 * plan.budget, `the spend fills up again (${plan.spent} of ${plan.budget})`);
    assert.ok(plan.purchases.length > 0);
});

test('skips: skipping tier 1 of a ladder skips the tier above it too', () => {
    const base = bought(solveWeeklyPlan(highs, data, planOptions()));
    assert.ok(base.has('research_tome_pack_t1') && base.has('research_tome_pack_t2'), 'the default plan buys both');
    const skipTier1 = bought(solveWeeklyPlan(highs, data, planOptions({ skippedPackages: ['research_tome_pack_t1'] })));
    assert.equal(skipTier1.has('research_tome_pack_t1'), false);
    assert.equal(skipTier1.has('research_tome_pack_t2'), false, 'tier 2 cannot be bought without tier 1');
    // Tier 2 skipped alone: it is not bought, tier 1 is not forced out (it just isn't worth buying on its own).
    const skipTier2Plan = solveWeeklyPlan(highs, data, planOptions({ skippedPackages: ['research_tome_pack_t2'] }));
    assert.equal(bought(skipTier2Plan).has('research_tome_pack_t2'), false);
    assert.ok(skipTier2Plan.spent > 0.9 * skipTier2Plan.budget, 'and the spend fills up again');
});
