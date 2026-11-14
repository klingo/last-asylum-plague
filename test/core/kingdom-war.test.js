import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayNumber, dayStartMs } from '../../webapp/src/core/schedule.js';
import { scrambleSlots, scrambleStatus, warPeriods, warStatus } from '../../webapp/src/core/kingdom-war.js';

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
