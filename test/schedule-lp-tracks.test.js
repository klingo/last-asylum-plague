import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    scheduleRuns,
    forecastRuns,
    weekdayRuns,
    weekdayIndex,
    gameDay,
    runStatus,
} from '../webapp/src/core/schedule.js';
import { createModel, addTerm, toLpText, varName, solveModel, loadHighs } from '../webapp/src/core/lp.js';
import { cheapestCostForPoints, trackTiers, trackPointsForPrice } from '../webapp/src/core/spend-tracks.js';

test('schedule: runs per id and their kind', () => {
    const runs = scheduleRuns({
        events: { bazaar: {}, raid: { category: 'ingame_event' } },
        spend_reward_tracks: { recipe: {} },
        schedule: {
            bazaar: [{ start: '2026-10-12', end: '2026-10-18' }],
            raid: [],
            recipe: [],
            gear_pass: [],
        },
    });
    assert.deepEqual(
        [...runs].map(([id, entry]) => [id, entry.kind]),
        [
            ['bazaar', 'event'],
            ['raid', 'ingame'],
            ['recipe', 'track'],
            ['gear_pass', 'pass'],
        ],
    );
    const { start, end } = runs.get('bazaar').runs[0];
    assert.equal(end - start, 6);
    assert.equal(weekdayIndex(start), 0, '2026-10-12 is a Monday');
});

test('schedule: forecast repeats the median gap and length', () => {
    const runs = [
        { start: 0, end: 6 },
        { start: 14, end: 20 },
        { start: 28, end: 33 },
    ];
    const forecast = forecastRuns(runs, { from: 30, to: 70, today: 30 });
    assert.deepEqual(
        forecast.map(({ start, end }) => [start, end]),
        [
            [42, 48],
            [56, 62],
            [70, 76],
        ],
    );
    assert.deepEqual(forecastRuns(runs.slice(0, 1), { from: 0, to: 70, today: 0 }), [], 'one run: no forecast');
});

test('schedule: weekday runs merge consecutive days', () => {
    // Day 0 (1970-01-01) is a Thursday.
    assert.deepEqual(weekdayRuns(['thursday', 'friday', 'monday'], 0, 7), [
        { start: 0, end: 1 },
        { start: 4, end: 4 },
        { start: 7, end: 7 },
    ]);
});

test('schedule: run status (running, upcoming, ended)', () => {
    const runs = [
        { start: 10, end: 16 },
        { start: 30, end: 36 },
    ];
    assert.deepEqual(runStatus(runs, 12), { state: 'running', run: runs[0], days: 4 });
    assert.equal(runStatus(runs, 16).days, 0, 'ends today');
    assert.deepEqual(runStatus(runs, 20), { state: 'upcoming', run: runs[1], days: 10 });
    assert.deepEqual(runStatus(runs, 40), { state: 'ended', run: runs[1], days: 4 });
    assert.equal(runStatus([], 12), null);
});

test('schedule: the game day starts at 02:00 UTC', () => {
    const oct17 = Date.UTC(2026, 9, 17) / 86400000;
    // 01:00 UTC on Oct 18 (03:00 CEST): still Oct 17, 23 of its 24 hours gone.
    assert.deepEqual(gameDay(new Date(Date.UTC(2026, 9, 18, 1))), { day: oct17, fraction: 23 / 24 });
    // 02:00 UTC on Oct 18: Oct 18 just started.
    assert.deepEqual(gameDay(new Date(Date.UTC(2026, 9, 18, 2))), { day: oct17 + 1, fraction: 0 });
    // 14:00 UTC: half through.
    assert.deepEqual(gameDay(new Date(Date.UTC(2026, 9, 18, 14))), { day: oct17 + 1, fraction: 0.5 });
});

test('lp: text format and a tiny solve', async () => {
    const model = createModel('max');
    const x = varName('p', 'pack-1');
    assert.equal(x, 'p__pack_1');
    addTerm(model.objective, x, 3);
    addTerm(model.objective, 'y', 2);
    addTerm(model.objective, 'y', 0);
    model.rows.push({
        name: 'budget',
        terms: new Map([
            [x, 1],
            ['y', 1],
        ]),
        op: '<=',
        rhs: 4,
    });
    model.bounds.set(x, { upper: 2.5 });
    model.integers.add(x);
    const text = toLpText(model);
    assert.match(text, /^Maximize\n obj: 3 p__pack_1 \+ 2 y\n/);
    assert.match(text, / budget: 1 p__pack_1 \+ 1 y <= 4\n/);
    assert.match(text, / 0 <= p__pack_1 <= 2\.5\n 0 <= y <= \+inf\n/);
    assert.match(text, /Generals\n p__pack_1\n/);

    const result = solveModel(await loadHighs(), model);
    assert.equal(result.status, 'Optimal');
    assert.equal(result.values.get(x), 2);
    assert.equal(result.values.get('y'), 2);
    assert.equal(result.objective, 10);
});

test('spend tracks: tier costs and track points', () => {
    const track = {
        conversions: [
            { price: 99, points: 100 },
            { price: 499, points: 500 },
            { price: 999, points: 1100 },
        ],
        tiers: { 1000: { gem: 1 }, 300: { ore: 5 }, 0: {} },
    };
    // Ten 99-packs (990) beat one 999-pack: the cheapest mix wins, not the biggest pack.
    assert.equal(cheapestCostForPoints(track.conversions, 1000), 990);
    assert.equal(cheapestCostForPoints(track.conversions, 300), 297);
    assert.deepEqual(
        trackTiers(track).map(({ threshold, stepCost, cumulativeCost }) => [threshold, stepCost, cumulativeCost]),
        [
            [300, 297, 297],
            [1000, 693, 990],
        ],
    );
    assert.equal(trackPointsForPrice(track, 499), 500);
    assert.equal(trackPointsForPrice({ conversions: [] }, 1234), 1234);
});
