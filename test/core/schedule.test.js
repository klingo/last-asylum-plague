import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    calendarSelection,
    forecastRuns,
    gameDay,
    isoWeekNumber,
    listRuns,
    nextRun,
    planningRun,
    freshSlot,
    rotationSlots,
    rotationWindow,
    runContains,
    runMoments,
    runStatus,
    scheduleBars,
    scheduleRuns,
    weekStart,
    weekdayIndex,
    weekdayOfferTiming,
    weekdayRuns,
} from '../../webapp/src/core/schedule.js';
import { MONDAY, day, iso } from '../helpers.js';

// Absolute game days as the data's dates.
const dates = (start, end) => ({ start: iso(start - MONDAY), end: iso(end - MONDAY) });

// --- runs, forecasts and status

test('schedule: runs per id and their kind', () => {
    const runs = scheduleRuns({
        events: {
            bazaar: {},
            raid: { category: 'ingame_event' },
            canyon: { category: 'ingame_event', calendar_group: 'alliance' },
        },
        spend_reward_tracks: { recipe: {} },
        schedule: {
            bazaar: [{ start: '2026-10-12', end: '2026-10-18' }],
            raid: [],
            canyon: [],
            recipe: [],
            gear_pass: [],
        },
    });
    assert.deepEqual(
        [...runs].map(([id, entry]) => [id, entry.kind]),
        [
            ['bazaar', 'event'],
            ['raid', 'ingame'],
            ['canyon', 'alliance'],
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

test('schedule: forecast continues a weekday pattern (Tuesdays and Thursdays)', () => {
    const tue = Date.UTC(2026, 9, 20) / 86400000; // a Tuesday
    // Tuesdays 1 day, Thursdays 2 days (Thu–Fri): gaps 2, 5, 2.
    const runs = [
        { start: tue, end: tue },
        { start: tue + 2, end: tue + 3 },
        { start: tue + 7, end: tue + 7 },
        { start: tue + 9, end: tue + 10 },
    ];
    const forecast = forecastRuns(runs, { from: tue, to: tue + 23, today: tue + 10 });
    assert.deepEqual(
        forecast.map(({ start, end }) => [start - tue, end - tue]),
        [
            [14, 14],
            [16, 17],
            [21, 21],
            [23, 24],
        ],
        'Tue, Thu, Tue, Thu, each as long as before',
    );
    assert.deepEqual(forecast[0].pattern, { days: 7, weekdays: ['tuesday', 'thursday'] });
    assert.ok(
        forecast.every((run, i) => i === 0 || forecast[i - 1].end < run.start),
        'no forecast run overlaps the next',
    );

    // Three runs (gaps 2, 5): not proven yet, the median gap (3.5 → 4) as before.
    const early = forecastRuns(runs.slice(0, 3), { from: tue, to: tue + 30, today: tue + 7 });
    assert.equal(early[0].start - tue, 11);
    assert.equal(early[0].pattern, undefined);
});

test('schedule: forecast finds longer cycles, and falls back on irregular gaps', () => {
    const mon = Date.UTC(2026, 9, 19) / 86400000; // a Monday
    // Mondays, Wednesdays and Fridays: gaps 2, 2, 3, 2, 2.
    const runs = [0, 2, 4, 7, 9, 11].map((offset) => ({ start: mon + offset, end: mon + offset }));
    const forecast = forecastRuns(runs, { from: mon, to: mon + 18, today: mon + 11 });
    assert.deepEqual(
        forecast.map(({ start }) => start - mon),
        [14, 16, 18],
    );
    assert.deepEqual(forecast[0].pattern.weekdays, ['monday', 'wednesday', 'friday']);

    // Gaps 5, 9, 4: no cycle, the median gap (5).
    const irregular = [0, 5, 14, 18].map((start) => ({ start, end: start }));
    const fallback = forecastRuns(irregular, { from: 0, to: 30, today: 18 });
    assert.deepEqual(
        fallback.map(({ start }) => start),
        [23, 28],
    );
    assert.equal(fallback[0].pattern, undefined);
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

test('schedule: a run starts and ends at the game day reset', () => {
    const oct12 = Date.UTC(2026, 9, 12) / 86400000;
    // Mon Oct 12 .. Sun Oct 18: from 02:00 UTC on Oct 12 to 02:00 UTC on Oct 19.
    assert.deepEqual(runMoments({ start: oct12, end: oct12 + 6 }), {
        start: Date.UTC(2026, 9, 12, 2),
        end: Date.UTC(2026, 9, 19, 2),
    });
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

test('schedule: forecast says how sure it is', () => {
    // Weekly, 1 day, proven (gaps 7, 7). The run on day 21 wasn't recorded; today is day 23: it is still a proven run.
    const weekly = [0, 7, 14].map((start) => ({ start, end: start }));
    const proven = forecastRuns(weekly, { from: 15, to: 30, today: 23 });
    assert.deepEqual(
        proven.map(({ start, proven: sure, stale }) => [start, sure, stale]),
        [
            [21, true, false],
            [28, true, false],
        ],
    );

    // Two runs (one gap): only a guess, and it says what it rests on.
    const guess = forecastRuns(weekly.slice(1), { from: 15, to: 30, today: 23 });
    assert.deepEqual(
        guess.map(({ start }) => start),
        [28],
    );
    assert.equal(guess[0].proven, false);
    assert.equal(guess[0].runCount, 2);
});

// --- proven forecasts
const weekly = (count, offset = 0) =>
    Array.from({ length: count }, (_, i) => ({
        start: iso(offset + i * 7),
        end: iso(offset + i * 7 + 2),
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
    const runs = [-21, -14, -7].map((back) => ({ start: iso(back), end: iso(back + 6) }));
    const data = { ...dataWith(runs), packages: {} };
    assert.deepEqual(calendarSelection(data, MONDAY + 3).activeEvents, ['weekly_event']);
});

// --- views (Calendar, Today)

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

// --- weekday offers

test('weekday offers: the test days are what they say', () => {
    assert.equal(weekdayIndex(day(2)), 2, 'Wednesday');
});

test('weekday offers: on sale today', () => {
    assert.deepEqual(weekdayOfferTiming(['wednesday'], day(2)), { state: 'today', days: 0 });
    assert.deepEqual(
        weekdayOfferTiming(['saturday', 'sunday'], day(6)),
        { state: 'today', days: 0 },
        'one of its days',
    );
});

test('weekday offers: still ahead this week, with the days until its next weekday', () => {
    assert.deepEqual(weekdayOfferTiming(['thursday'], day(2)), { state: 'upcoming', days: 1 });
    assert.deepEqual(weekdayOfferTiming(['friday'], day(0)), { state: 'upcoming', days: 4 });
    assert.deepEqual(
        weekdayOfferTiming(['saturday', 'sunday'], day(2)),
        { state: 'upcoming', days: 3 },
        'the nearer day',
    );
    assert.deepEqual(
        weekdayOfferTiming(['monday', 'friday'], day(2)),
        { state: 'upcoming', days: 2 },
        'skips the past day',
    );
});

test('weekday offers: over once every weekday is earlier this week', () => {
    assert.deepEqual(weekdayOfferTiming(['monday'], day(2)), { state: 'past', days: 0 });
    assert.deepEqual(weekdayOfferTiming(['monday', 'tuesday'], day(6)), { state: 'past', days: 0 });
});

test('weekday offers: without weekdays it is on sale any day', () => {
    assert.equal(weekdayOfferTiming(undefined, day(3)).state, 'today');
    assert.equal(weekdayOfferTiming([], day(3)).state, 'today');
});

// --- event rotations
// Survival Battle's shape: 42 slots of 4 hours from Sunday's daily reset (02:00 UTC = 00:00 server time). It isn't a
// plain loop: a round of five (T S R V H), then Territory > Heroes, then seven rounds of five up to the week's end.
const LETTERS = { T: 'Territory', S: 'Soldiers', R: 'Research', V: 'Raven', H: 'Heroes' };
const phases = Object.entries(LETTERS).map(([id, en]) => ({ id, name: { en } }));
const rotation = {
    week_starts: 'sunday',
    hours: 4,
    phases,
    week: [...`TSRVH${'TH'}${'TSRVH'.repeat(7)}`],
};
const HOUR = 3600000;
// Sunday 2026-11-01, 02:00 UTC: the start of a week.
const rotationStart = Date.UTC(2026, 10, 1, 2);
const slotAt = (hours) => rotationStart + hours * HOUR;
const names = ({ current, next }) => [current.phase.name.en, next.phase.name.en];

test('rotation: the week starts with its first slot at Sunday 02:00 UTC', () => {
    const { current, next } = rotationSlots(rotation, rotationStart);
    assert.deepEqual(names({ current, next }), ['Territory', 'Soldiers']);
    assert.equal(current.start, rotationStart);
    assert.equal(current.end, rotationStart + 4 * HOUR);
    assert.equal(next.start, current.end);
    assert.equal(current.slot, 0);
    assert.equal(current.phaseId, 'T');
});

test('rotation: the last moment before a boundary is still the old slot', () => {
    assert.deepEqual(names(rotationSlots(rotation, slotAt(4) - 1)), ['Territory', 'Soldiers']);
    assert.deepEqual(names(rotationSlots(rotation, slotAt(4))), ['Soldiers', 'Research']);
});

test('rotation: the sequence is followed as listed, not looped', () => {
    // Slots 6 and 7 (1-based) are Territory > Heroes, then the regular rounds go on from slot 8.
    const at = (slot) => names(rotationSlots(rotation, slotAt(slot * 4)));
    assert.deepEqual(at(4), ['Heroes', 'Territory']);
    assert.deepEqual(at(5), ['Territory', 'Heroes']);
    assert.deepEqual(at(6), ['Heroes', 'Territory']);
    assert.deepEqual(at(7), ['Territory', 'Soldiers']);
    // Every slot matches the list.
    for (let k = 0; k < rotation.week.length; k += 1) {
        assert.equal(rotationSlots(rotation, slotAt(k * 4 + 1)).current.phaseId, rotation.week[k]);
    }
});

test('rotation: the last slot of the week is Heroes, then the week starts over', () => {
    const lastStart = slotAt(41 * 4);
    const { current, next } = rotationSlots(rotation, lastStart + HOUR);
    assert.deepEqual(names({ current, next }), ['Heroes', 'Territory']);
    assert.equal(current.slot, 41);
    assert.equal(current.start, lastStart);
    assert.equal(current.end, rotationStart + 7 * 24 * HOUR);
    assert.equal(next.start, current.end);
    assert.equal(next.slot, 0);
    // At that moment the new week has begun.
    assert.deepEqual(names(rotationSlots(rotation, current.end)), ['Territory', 'Soldiers']);
});

test('rotation: Saturday late and Sunday before the reset still belong to the old week', () => {
    // Sunday 01:59 UTC is still the game day Saturday: the old week's last slot.
    const { current } = rotationSlots(rotation, Date.UTC(2026, 10, 8, 1, 59));
    assert.equal(current.phase.name.en, 'Heroes');
    assert.equal(current.end, Date.UTC(2026, 10, 8, 2));
});

test('rotation: another week start and slot length', () => {
    const daily = {
        week_starts: 'monday',
        hours: 24,
        phases: ['a', 'b', 'c'].map((id) => ({ id, name: { en: id.toUpperCase() } })),
        week: ['a', 'b', 'a', 'b', 'c', 'c', 'a'],
    };
    // Monday 2026-11-02 02:00 UTC starts the week.
    const monday = Date.UTC(2026, 10, 2, 2);
    assert.deepEqual(names(rotationSlots(daily, monday)), ['A', 'B']);
    assert.deepEqual(names(rotationSlots(daily, monday + 4 * 24 * HOUR + HOUR)), ['C', 'C']);
    assert.deepEqual(names(rotationSlots(daily, monday + 6 * 24 * HOUR + HOUR)), ['A', 'A']);
    assert.deepEqual(names(rotationSlots(daily, monday + 7 * 24 * HOUR)), ['A', 'B']);
});

test('rotation window: seven days of slots, across the week boundary, in order', () => {
    // From Wednesday 2026-11-04 02:00 UTC for 7 days: 42 slots, the rest of the week (slot 24 on), then the next week.
    const from = slotAt(3 * 24);
    const slots = rotationWindow(rotation, from, from + 7 * 24 * HOUR);
    assert.equal(slots.length, 42);
    assert.equal(slots[0].start, from);
    assert.equal(slots[0].slot, 18);
    assert.equal(slots.at(-1).end, from + 7 * 24 * HOUR);
    // Slots follow each other without gaps; after slot 41 comes slot 0 of the next week.
    slots.slice(1).forEach((slot, index) => assert.equal(slot.start, slots[index].end));
    const wrap = slots.findIndex((slot) => slot.slot === 0);
    assert.equal(slots[wrap - 1].slot, 41);
    assert.equal(slots[wrap].start, rotationStart + 7 * 24 * HOUR);
    assert.deepEqual(
        slots.map((slot) => slot.phaseId),
        [...Array(42).keys()].map((index) => rotation.week[(18 + index) % 42]),
    );
});

test('rotation window: a slot the window cuts is included whole', () => {
    // 05:00 UTC Sunday is an hour into slot 0 (02:00-06:00); the window ends an hour into slot 2 (10:00-14:00).
    const slots = rotationWindow(rotation, slotAt(3), slotAt(9));
    assert.deepEqual(
        slots.map((slot) => slot.slot),
        [0, 1, 2],
    );
    assert.equal(slots[0].start, rotationStart);
    assert.equal(slots[2].end, slotAt(12));
});

test('a round has just begun while its slot started within the grace time', () => {
    const grace = 3 * 60000;
    assert.equal(freshSlot(rotation, slotAt(4), grace).phaseId, 'S', 'the moment it starts');
    assert.equal(freshSlot(rotation, slotAt(4) + grace, grace).slot, 1, 'up to the grace time');
    assert.equal(freshSlot(rotation, slotAt(4) + grace + 1, grace), null, 'later: not new any more');
    assert.equal(freshSlot(rotation, slotAt(4) - 1, grace), null, 'just before the next slot: the old one is not new');
});

test('the first slot of the next week is a new round too', () => {
    const weekEnd = rotationStart + 7 * 24 * HOUR;
    assert.equal(freshSlot(rotation, weekEnd + 60000, 3 * 60000).slot, 0);
});
