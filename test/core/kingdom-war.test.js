import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayNumber, dayStartMs } from '../../webapp/src/core/schedule.js';
import {
    curseRuns,
    curseStatus,
    scrambleSlots,
    scrambleStatus,
    warPeriods,
    warStatus,
} from '../../webapp/src/core/kingdom-war.js';

// The cycle as the game runs it: three war weeks (Monday to the end of Saturday) and a break week, from Monday 2026-10-26.
const war = {
    cycle_start: '2026-10-26',
    days: 6,
    weeks: [
        { id: 'week_1', name: { en: 'Week 1' } },
        { id: 'week_2', name: { en: 'Week 2' } },
        { id: 'finals', name: { en: 'Week 3: Finals' } },
        null,
    ],
    royal_city_scramble: { weekday: 'saturday', start_hour: 12, hours: 4 },
    origin_of_the_curse: {
        phases: [
            { id: 'preview', name: { en: 'Preview' } },
            { id: 'preparation', name: { en: 'Preparation' } },
            { id: 'contest', name: { en: 'Contest' } },
            { id: 'results', name: { en: 'Results' } },
        ],
        timeline: [
            { phase: 'preview', weekday: 'tuesday', time: '00:00' },
            { phase: 'preparation', weekday: 'saturday', time: '00:00' },
            { phase: 'contest', weekday: 'saturday', time: '00:40' },
            { phase: 'preparation', weekday: 'saturday', time: '01:10' },
            { phase: 'contest', weekday: 'saturday', time: '13:00' },
            { phase: 'results', weekday: 'saturday', time: '13:30' },
        ],
    },
};
const day = dayNumber;
const HOUR = 3600000;
const ids = (periods) => periods.map((period) => (period.kind === 'week' ? period.week.id : period.kind));

test('war periods: three war weeks, then the break, then the cycle starts again', () => {
    const periods = warPeriods(war, day('2026-10-26'), day('2026-12-06'));
    assert.deepEqual(ids(periods), ['week_1', 'week_2', 'finals', 'break', 'week_1', 'week_2']);
    // A war week runs from its Monday through Saturday (6 game days).
    assert.deepEqual([periods[0].start, periods[0].end], [day('2026-10-26'), day('2026-10-31')]);
    assert.deepEqual([periods[2].start, periods[2].end], [day('2026-11-09'), day('2026-11-14')]);
    // The break takes the Sundays on both sides along: Sunday Nov 15 to Sunday Nov 22.
    assert.deepEqual([periods[3].start, periods[3].end], [day('2026-11-15'), day('2026-11-22')]);
    assert.equal(periods[4].start, day('2026-11-23'));
});

test('war periods: only those overlapping the window, and an earlier cycle works too', () => {
    assert.deepEqual(ids(warPeriods(war, day('2026-11-14'), day('2026-11-14'))), ['finals']);
    assert.deepEqual(ids(warPeriods(war, day('2026-11-16'), day('2026-11-18'))), ['break']);
    // The cycle before cycle_start: its Week 1 began 28 days earlier.
    const before = warPeriods(war, day('2026-09-28'), day('2026-10-03'));
    assert.deepEqual(ids(before), ['week_1']);
    assert.equal(before[0].start, day('2026-09-28'));
});

test('war status: the week on now, and the next one', () => {
    const lastDay = warStatus(war, day('2026-11-14'));
    assert.equal(lastDay.current.week.id, 'finals', 'the last day of Week 3');
    assert.equal(lastDay.next.week.id, 'week_1');
    assert.equal(lastDay.next.start, day('2026-11-23'));

    const sunday = warStatus(war, day('2026-11-15'));
    assert.equal(sunday.current.kind, 'break', 'the Sunday after the finals starts the break');
    assert.equal(sunday.next.start, day('2026-11-23'));
    assert.equal(warStatus(war, day('2026-11-22')).current.kind, 'break', 'the last day of the break');
    assert.equal(warStatus(war, day('2026-11-23')).current.week.id, 'week_1');

    const between = warStatus(war, day('2026-11-08'));
    assert.equal(between.current, null, 'the Sunday between two war weeks is no period');
    assert.equal(between.next.week.id, 'finals');
});

test('scramble: every Saturday from 12:00 to 16:00 server time (14:00 to 18:00 UTC), the break included', () => {
    const slots = scrambleSlots(war, Date.UTC(2026, 10, 9), Date.UTC(2026, 10, 24));
    assert.deepEqual(
        slots.map((slot) => [slot.start, slot.end]),
        [
            [Date.UTC(2026, 10, 14, 14), Date.UTC(2026, 10, 14, 18)],
            [Date.UTC(2026, 10, 21, 14), Date.UTC(2026, 10, 21, 18)],
        ],
    );
    assert.equal(slots[0].start, dayStartMs(day('2026-11-14')) + 12 * HOUR, '12:00 after the reset');
});

test('scramble: a slot the window cuts is included, and the status says what is on and what is next', () => {
    const during = Date.UTC(2026, 10, 14, 15);
    assert.equal(scrambleSlots(war, during, during + 1).length, 1);
    const on = scrambleStatus(war, during);
    assert.equal(on.current.start, Date.UTC(2026, 10, 14, 14));
    assert.equal(on.next.start, Date.UTC(2026, 10, 21, 14));

    const before = scrambleStatus(war, Date.UTC(2026, 10, 14, 13, 59));
    assert.equal(before.current, null);
    assert.equal(before.next.start, Date.UTC(2026, 10, 14, 14));
    assert.equal(scrambleStatus(war, Date.UTC(2026, 10, 14, 14)).current.end, Date.UTC(2026, 10, 14, 18));
    // The moment it ends it is over: the next one is the following Saturday.
    const after = scrambleStatus(war, Date.UTC(2026, 10, 14, 18));
    assert.equal(after.current, null);
    assert.equal(after.next.start, Date.UTC(2026, 10, 21, 14));
});

// The reset is 02:00 UTC = 00:00 server time, so Saturday 00:40 server time is 02:40 UTC.
const MINUTE = 60000;
const contestStart = Date.UTC(2026, 10, 21, 2, 40);

test('curse: one run in the break week, from Tuesday to the end of Sunday, cut into the timeline phases', () => {
    const runs = curseRuns(war, Date.UTC(2026, 10, 9), Date.UTC(2026, 11, 7));
    assert.equal(runs.length, 1, 'the next break week is the one of Dec 14, outside the window');
    const [run] = runs;
    assert.equal(run.start, dayStartMs(day('2026-11-17')), 'Tuesday 00:00 server time');
    assert.equal(run.end, dayStartMs(day('2026-11-23')), "Monday's reset: the end of Sunday");
    assert.deepEqual(
        run.segments.map(({ phase, start, end }) => [phase.id, start - contestStart, end - contestStart]),
        [
            ['preview', -(4 * 24 * 60 + 40) * MINUTE, -40 * MINUTE],
            ['preparation', -40 * MINUTE, 0],
            ['contest', 0, 30 * MINUTE],
            ['preparation', 30 * MINUTE, 12 * 60 * MINUTE + 20 * MINUTE],
            ['contest', 12 * 60 * MINUTE + 20 * MINUTE, 12 * 60 * MINUTE + 50 * MINUTE],
            ['results', 12 * 60 * MINUTE + 50 * MINUTE, run.end - contestStart],
        ],
    );
});

test('curse runs: only those overlapping the window, and the next cycle has its own', () => {
    assert.equal(curseRuns(war, Date.UTC(2026, 10, 24), Date.UTC(2026, 11, 13)).length, 0, 'war weeks only');
    const later = curseRuns(war, Date.UTC(2026, 10, 9), Date.UTC(2026, 11, 20));
    assert.deepEqual(
        later.map((run) => run.start),
        [dayStartMs(day('2026-11-17')), dayStartMs(day('2026-12-15'))],
    );
    // A window that only touches the Sunday still gets the run.
    assert.equal(curseRuns(war, Date.UTC(2026, 10, 22, 12), Date.UTC(2026, 10, 22, 13)).length, 1);
});

test('curse runs: a null entry ends the event early', () => {
    const early = {
        ...war,
        origin_of_the_curse: {
            ...war.origin_of_the_curse,
            timeline: [...war.origin_of_the_curse.timeline, { phase: null, weekday: 'sunday', time: '12:00' }],
        },
    };
    const [run] = curseRuns(early, Date.UTC(2026, 10, 16), Date.UTC(2026, 10, 24));
    assert.equal(run.segments.length, 6);
    assert.equal(run.end, dayStartMs(day('2026-11-22')) + 12 * HOUR);
    assert.equal(run.segments[5].end, run.end, 'Results end where the null entry starts');
});

test('curse status: the phase on now and the next one, also across the weeks of war', () => {
    const preview = curseStatus(war, Date.UTC(2026, 10, 17, 12));
    assert.equal(preview.current.phase.id, 'preview');
    assert.equal(preview.next.phase.id, 'preparation');
    assert.equal(preview.next.start, dayStartMs(day('2026-11-21')));

    const contest = curseStatus(war, contestStart + 10 * MINUTE);
    assert.equal(contest.current.phase.id, 'contest');
    assert.equal(contest.next.phase.id, 'preparation');
    assert.equal(
        curseStatus(war, contestStart + 30 * MINUTE).current.phase.id,
        'preparation',
        'over the moment it ends',
    );

    // Monday of the break week, before the run: nothing on, the run's first phase is next.
    const before = curseStatus(war, Date.UTC(2026, 10, 16, 12));
    assert.equal(before.current, null);
    assert.equal(before.next.phase.id, 'preview');
    // A war week: the next run is the break week of the next cycle.
    const during = curseStatus(war, Date.UTC(2026, 10, 24, 12));
    assert.equal(during.current, null);
    assert.equal(during.next.start, dayStartMs(day('2026-12-15')));
    // The moment the run ends nothing is on.
    assert.equal(curseStatus(war, dayStartMs(day('2026-11-23'))).current, null);
});
