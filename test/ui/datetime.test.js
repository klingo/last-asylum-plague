import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatGameDay, formatGameDayRange, pad2 } from '../../webapp/src/ui/datetime.js';
import { setLocale } from '../../webapp/src/ui/i18n.js';
import { day } from '../helpers.js';

test('numbers are padded to two digits', () => {
    assert.equal(pad2(5), '05');
    assert.equal(pad2(12), '12');
});

test('a game day is shown as its date, whatever the time zone', () => {
    assert.equal(formatGameDay(day(0)), 'Mon, Nov 2');
    assert.equal(formatGameDay(day(0), { weekday: 'long' }), 'Monday');
});

test('a range names both days, a one-day run only one', () => {
    assert.equal(formatGameDayRange(day(0), day(2)), 'Mon, Nov 2 – Wed, Nov 4');
    assert.equal(formatGameDayRange(day(0), day(0)), 'Mon, Nov 2');
});

test('dates follow the language', () => {
    setLocale('de');
    assert.equal(formatGameDay(day(0), { weekday: 'long' }), 'Montag');
});
