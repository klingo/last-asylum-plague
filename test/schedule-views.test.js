import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isoWeekNumber,
    listRuns,
    nextRun,
    planningRun,
    runContains,
    scheduleBars,
    weekStart,
} from '../webapp/src/core/schedule.js';

// Day numbers (days since 1970-01-01); the schedule's dates are written as ISO dates.
const MONDAY = Date.UTC(2026, 10, 2) / 86400000;
const iso = (day) => new Date(day * 86400000).toISOString().slice(0, 10);
const dates = (start, end) => ({ start: iso(start), end: iso(end) });

test('a run contains its first and last day; a week starts on Monday', () => {
    const run = { start: 10, end: 12 };
    assert.deepEqual(
        [9, 10, 11, 12, 13].map((day) => runContains(run, day)),
        [false, true, true, true, false],
    );
    assert.equal(weekStart(MONDAY), MONDAY);
    assert.equal(weekStart(MONDAY + 6), MONDAY);
    assert.equal(weekStart(MONDAY + 7), MONDAY + 7);
    assert.equal(isoWeekNumber(MONDAY), 45, 'Nov 2, 2026 is in ISO week 45');
    assert.equal(isoWeekNumber(MONDAY + 6), 45);
    assert.equal(isoWeekNumber(MONDAY + 7), 46);
});

test('the next run: a recorded one still to come, else the first forecast, else none', () => {
    const past = [
        { start: MONDAY - 14, end: MONDAY - 8 },
        { start: MONDAY - 7, end: MONDAY - 1 },
    ];
    // Two runs a week apart: the rhythm is a guess, but the next run is still ahead.
    assert.equal(nextRun(past, MONDAY).start, MONDAY);
    const recorded = [...past, { start: MONDAY + 10, end: MONDAY + 12 }];
    assert.deepEqual(nextRun(recorded, MONDAY), { start: MONDAY + 10, end: MONDAY + 12 });
    assert.equal(nextRun([past[0]], MONDAY), null, 'a single run forecasts nothing');
    assert.equal(nextRun(past, MONDAY - 3).start, MONDAY);
    assert.equal(nextRun(past, MONDAY - 3, 1), null, 'the forecast starts after a horizon of 1 day');
});

// An event with three recorded runs a week apart (3 days each): the pattern is proven.
const data = {
    events: { pattern: {}, late: {} },
    packages: {},
    schedule: {
        pattern: [-21, -14, -7].map((back) => dates(MONDAY + back, MONDAY + back + 2)),
        late: [dates(MONDAY + 4, MONDAY + 5)],
    },
};

test('the run a plan is about: the one on now, else the next', () => {
    assert.deepEqual(planningRun(data, 'pattern', MONDAY + 1), { state: 'running', start: MONDAY, days: 2 });
    assert.deepEqual(planningRun(data, 'pattern', MONDAY - 2), { state: 'next', start: MONDAY, days: 3 });
    assert.deepEqual(planningRun(data, 'late', MONDAY), { state: 'next', start: MONDAY + 4, days: 2 });
    assert.equal(planningRun(data, 'unknown', MONDAY), null);
});

test('what runs today and what starts in the next days', () => {
    const { running, soon } = listRuns(data, MONDAY + 1, 4);
    assert.deepEqual(
        running.map(({ id, forecast }) => [id, forecast]),
        [['pattern', true]],
        "today's run is the proven pattern's, not recorded",
    );
    assert.deepEqual(
        soon.map(({ id, forecast, run }) => [id, forecast, run.start]),
        [['late', false, MONDAY + 4]],
        'the pattern starts again a week later: not within 4 days',
    );
    assert.deepEqual(
        listRuns(data, MONDAY + 1, 7)
            .soon.map(({ id }) => id)
            .sort(),
        ['late', 'pattern'],
    );
});

test('timeline bars: recorded runs (past ones flagged) and the forecast ahead', () => {
    const rows = scheduleBars(data, MONDAY + 1, MONDAY - 21, MONDAY + 13);
    const pattern = rows.find((row) => row.id === 'pattern');
    assert.equal(pattern.kind, 'event');
    assert.deepEqual(
        pattern.bars.map(({ start, past, forecast }) => [start - MONDAY, Boolean(past), Boolean(forecast)]),
        [
            [-21, true, false],
            [-14, true, false],
            [-7, true, false],
            [0, false, true],
            [7, false, true],
        ],
    );
    assert.equal(rows.find((row) => row.id === 'late').bars.length, 1);
    // A narrow window leaves out what is outside it.
    const narrow = scheduleBars(data, MONDAY + 1, MONDAY + 4, MONDAY + 5);
    assert.deepEqual(
        narrow.map((row) => row.id),
        ['late'],
    );
});
