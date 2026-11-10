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

// Runs of 3 days starting on the given dates.
const threeDays = (...starts) => starts.map((start) => ({ start, end: addDays(start, 2) }));

test('only the last 12 runs of an id are kept; an older run recorded later is dropped at once', () => {
    const starts = Array.from({ length: 12 }, (_, i) => addDays('2026-01-05', i * 7));
    const data = { schedule: { bazaar: threeDays(...starts) } };

    const next = recordRun(data, ['bazaar'], addDays(starts[11], 7), addDays(starts[11], 9));
    assert.equal(data.schedule.bazaar.length, 12);
    assert.equal(data.schedule.bazaar[0].start, starts[1]);
    assert.equal(data.schedule.bazaar[11].start, addDays(starts[11], 7));
    assert.deepEqual(next.changes, [
        `  bazaar: ${addDays(starts[11], 7)}..${addDays(starts[11], 9)}`,
        `  bazaar: ${starts[0]}..${addDays(starts[0], 2)} dropped (keeps the last 12)`,
    ]);

    const before = structuredClone(data);
    const old = recordRun(data, ['bazaar'], '2025-12-01', '2025-12-01');
    assert.deepEqual(data, before);
    assert.match(old.changes[1], /bazaar: 2025-12-01\.\.2025-12-01 dropped/);
});

test('a new run on the proven pattern also records the runs missed in between', () => {
    const data = { schedule: { weekly: threeDays('2026-10-05', '2026-10-12', '2026-10-19') } };
    const result = recordRun(data, ['weekly'], '2026-11-02', '2026-11-04');
    assert.deepEqual(
        data.schedule.weekly.map((run) => run.start),
        ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'],
    );
    assert.deepEqual(data.schedule.weekly[3], { start: '2026-10-26', end: '2026-10-28' });
    assert.deepEqual(result.changes, [
        '  weekly: 2026-10-26..2026-10-28 (filled in from the pattern)',
        '  weekly: 2026-11-02..2026-11-04',
    ]);
});

test('nothing is filled in for a run off the pattern, after a long pause, or for a correction', () => {
    const history = () => ({ schedule: { weekly: threeDays('2026-10-05', '2026-10-12', '2026-10-19') } });

    const off = history();
    recordRun(off, ['weekly'], '2026-11-04', '2026-11-04');
    assert.equal(off.schedule.weekly.length, 4, 'a Wednesday is not on the weekly pattern');

    const late = history();
    recordRun(late, ['weekly'], '2027-01-04', '2027-01-06');
    assert.equal(late.schedule.weekly.length, 4, 'a Monday, but 11 weeks after the last run: the pattern is stale');

    const corrected = history();
    recordRun(corrected, ['weekly'], '2026-10-19', '2026-10-25');
    assert.equal(corrected.schedule.weekly.length, 3);

    const single = { schedule: { weekly: threeDays('2026-10-05') } };
    recordRun(single, ['weekly'], '2026-10-19', '2026-10-21');
    assert.equal(single.schedule.weekly.length, 2, 'one run proves no pattern');
});

test('an overlapping run is refused and nothing is recorded, not even for the other ids', () => {
    const data = { schedule: { bazaar: [{ start: '2026-10-12', end: '2026-10-18' }] } };
    const before = structuredClone(data);
    const result = recordRun(data, ['gear_pass', 'bazaar'], '2026-10-16', '2026-10-20');
    assert.match(result.error, /bazaar: 2026-10-16\.\.2026-10-20 overlaps its recorded run 2026-10-12\.\.2026-10-18/);
    assert.deepEqual(data, before);
});
