import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatDaySpan, formatRunDays, formatRunRange, pad2 } from '../../webapp/src/ui/datetime.js';
import { setLocale } from '../../webapp/src/ui/i18n.js';
import { runMoments } from '../../webapp/src/core/schedule.js';
import { day } from '../helpers.js';

// The tests' moments are shown in this time zone (UTC+8: the game day's reset, 02:00 UTC, is 10:00).
process.env.TZ = 'Asia/Singapore';

test('numbers are padded to two digits', () => {
    assert.equal(pad2(5), '05');
    assert.equal(pad2(12), '12');
});

test('a date is the local one of the moment', () => {
    // 20:00 UTC on Nov 2 is already Nov 3 in Singapore.
    const ms = Date.UTC(2026, 10, 2, 20);
    assert.equal(formatDate(ms), 'Tue, Nov 3');
    assert.equal(formatDate(ms, { weekday: 'long' }), 'Tuesday');
});

test('a run is shown from the moment it starts to the moment it ends, in local time', () => {
    // The game days Nov 2 .. Nov 8 run from 02:00 UTC on Nov 2 to 02:00 UTC on Nov 9: 10:00 to 10:00 in Singapore.
    const { start, end } = runMoments({ start: day(0), end: day(6) });
    assert.equal(formatRunRange(start, end), 'Mon, Nov 2, 10:00 AM – Mon, Nov 9, 10:00 AM');
});

test('a run within one local day names its date once; one that ends at midnight still does', () => {
    assert.equal(
        formatRunRange(Date.UTC(2026, 10, 2, 2), Date.UTC(2026, 10, 2, 6)),
        'Mon, Nov 2 · 10:00 AM – 02:00 PM',
    );
    // 16:00 UTC is 00:00 the next day in Singapore.
    assert.equal(
        formatRunRange(Date.UTC(2026, 10, 2, 12), Date.UTC(2026, 10, 2, 16)),
        'Mon, Nov 2 · 08:00 PM – 12:00 AM',
    );
});

test('a span of whole days names its clock time once, unless the two moments differ', () => {
    assert.equal(
        formatDaySpan(Date.UTC(2026, 10, 2, 2), Date.UTC(2026, 10, 3, 2)),
        'Mon, Nov 2 – Tue, Nov 3 · 10:00 AM',
    );
    assert.equal(
        formatDaySpan(Date.UTC(2026, 10, 2, 2), Date.UTC(2026, 10, 3, 3)),
        'Mon, Nov 2, 10:00 AM – Tue, Nov 3, 11:00 AM',
    );
});

test('a run of game days is shown with its number of days', () => {
    assert.equal(formatRunDays({ start: day(0), end: day(6) }), 'Mon, Nov 2 – Mon, Nov 9 · 10:00 AM (7 days)');
    assert.match(formatRunDays({ start: day(0), end: day(0) }), / \(1 day\)$/);
});

test('dates follow the language', () => {
    setLocale('de');
    assert.equal(formatDate(Date.UTC(2026, 10, 2, 2), { weekday: 'long' }), 'Montag');
});
