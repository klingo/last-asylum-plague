import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, daysText, isValidDate, parseRecordArgs, recordRun } from '../../scripts/record-run.js';

test('the command line is sorted into ids, dates and day counts', () => {
    assert.deepEqual(parseRecordArgs(['strange_bazaar', 'gear_pass', '2026-10-12', '7', '--show']), {
        ids: ['strange_bazaar', 'gear_pass'],
        dates: ['2026-10-12'],
        counts: ['7'],
    });
    assert.deepEqual(parseRecordArgs([]), { ids: [], dates: [], counts: [] });
});

test('dates are real calendar days; adding days crosses months, years and leap days', () => {
    assert.equal(isValidDate('2026-10-12'), true);
    assert.equal(isValidDate('2026-02-30'), false);
    assert.equal(isValidDate('2026-13-01'), false);
    assert.equal(isValidDate('12.10.2026'), false);
    assert.equal(addDays('2026-10-12', 6), '2026-10-18');
    assert.equal(addDays('2026-12-30', 3), '2027-01-02');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2026-10-12', 0), '2026-10-12');
});

test('a run is told with its weekdays and number of days, whatever the local time zone', () => {
    assert.equal(daysText('2026-10-12', '2026-10-18'), 'Mon 2026-10-12 .. Sun 2026-10-18, 7 days');
    assert.equal(daysText('2026-10-12', '2026-10-12'), 'Mon 2026-10-12 .. Mon 2026-10-12, 1 day');
});

test('a new run is added, one with the same start corrects its length', () => {
    const data = { schedule: { bazaar: [{ start: '2026-10-12', end: '2026-10-14' }] } };
    const added = recordRun(data, ['bazaar', 'gear_pass'], '2026-10-26', '2026-10-28');
    assert.deepEqual(data.schedule.bazaar, [
        { start: '2026-10-12', end: '2026-10-14' },
        { start: '2026-10-26', end: '2026-10-28' },
    ]);
    assert.deepEqual(data.schedule.gear_pass, [{ start: '2026-10-26', end: '2026-10-28' }]);
    assert.equal(added.changes.length, 2);

    const corrected = recordRun(data, ['bazaar'], '2026-10-12', '2026-10-15');
    assert.equal(data.schedule.bazaar[0].end, '2026-10-15');
    assert.match(corrected.changes[0], /\(updated\)$/);
});

test('an overlapping run is refused and nothing is recorded, not even for the other ids', () => {
    const data = { schedule: { bazaar: [{ start: '2026-10-12', end: '2026-10-18' }] } };
    const before = structuredClone(data);
    const result = recordRun(data, ['gear_pass', 'bazaar'], '2026-10-16', '2026-10-20');
    assert.match(result.error, /bazaar: 2026-10-16\.\.2026-10-20 overlaps its recorded run 2026-10-12\.\.2026-10-18/);
    assert.deepEqual(data, before);
});
