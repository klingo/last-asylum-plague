import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarSelection, forecastRuns, scheduleRuns } from '../webapp/src/core/schedule.js';

// Day numbers (days since 1970-01-01) as the schedule's dates.
const MONDAY = Date.UTC(2026, 10, 2) / 86400000;
const iso = (day) => new Date(day * 86400000).toISOString().slice(0, 10);
const weekly = (count, offset = 0) =>
    Array.from({ length: count }, (_, i) => ({
        start: iso(MONDAY + offset + i * 7),
        end: iso(MONDAY + offset + i * 7 + 2),
    }));
// The recorded runs as day numbers (what forecastRuns takes).
const recorded = (count) => scheduleRuns(dataWith(weekly(count))).get('weekly_event').runs;
const dataWith = (runs) => ({ events: { weekly_event: { name: { en: 'Weekly' } } }, schedule: { weekly_event: runs } });

test('proven forecast: runs that started by today are given and count as runs', () => {
    // Recorded weeks 0..2 (days 0-2, 7-9, 14-16), nothing after; today is day 24 (week 3's run ran 21-23).
    const today = MONDAY + 24;
    const data = dataWith(weekly(3));
    assert.deepEqual(
        scheduleRuns(data)
            .get('weekly_event')
            .runs.map((run) => run.start - MONDAY),
        [0, 7, 14],
        'without today: the recorded runs only',
    );
    const runs = scheduleRuns(data, today).get('weekly_event').runs;
    assert.deepEqual(
        runs.map((run) => [run.start - MONDAY, Boolean(run.forecast)]),
        [
            [0, false],
            [7, false],
            [14, false],
            [21, true],
        ],
    );
    assert.equal(runs[3].proven, true);
    assert.equal(runs[3].end - MONDAY, 23);
});

test('proven forecast: passing the runs back in neither repeats them nor moves the limit', () => {
    const today = MONDAY + 24;
    const runs = scheduleRuns(dataWith(weekly(3)), today).get('weekly_event').runs;
    const next = forecastRuns(runs, { from: today, to: today + 20, today });
    assert.deepEqual(
        next.map((run) => run.start - MONDAY),
        [28, 35, 42],
        'only runs after the last given one',
    );
    assert.equal(next[0].last.start - MONDAY, 14, 'its basis is still the last recorded run');
});

test('proven forecast: 8 weeks after the last recorded run it is a rough guess again', () => {
    const data = dataWith(weekly(3));
    const lastEnd = MONDAY + 16;
    const fresh = scheduleRuns(data, lastEnd + 56).get('weekly_event').runs;
    assert.ok(fresh.length > 3, '56 days after: still trusted');
    const stale = scheduleRuns(data, lastEnd + 57).get('weekly_event').runs;
    assert.equal(stale.length, 3, '57 days after: no assumed runs');
    const guess = forecastRuns(recorded(3), { from: lastEnd + 57, to: lastEnd + 70, today: lastEnd + 57 });
    assert.ok(guess.length > 0);
    assert.ok(guess.every((run) => run.proven === false && run.stale === true));
    assert.ok(
        guess.every((run) => run.end >= lastEnd + 57),
        'a guess is only given if it did not end before today',
    );
});

test('proven forecast: a pattern not yet repeated stays a guess and counts for nothing', () => {
    const today = MONDAY + 24;
    const runs = scheduleRuns(dataWith(weekly(2)), today).get('weekly_event').runs;
    assert.equal(runs.length, 2);
    assert.equal(forecastRuns(recorded(2), { from: today, to: today + 14, today })[0].proven, false);
});

test('proven forecast: Follow the calendar selects an event whose pattern runs today', () => {
    // An event with 3 recorded weekly runs: the run its pattern continues with, the week from MONDAY on, covers
    // the Thursday of that week, so the event is selected then.
    const runs = [-21, -14, -7].map((back) => ({ start: iso(MONDAY + back), end: iso(MONDAY + back + 6) }));
    const data = { ...dataWith(runs), packages: {} };
    assert.deepEqual(calendarSelection(data, MONDAY + 3).activeEvents, ['weekly_event']);
});
