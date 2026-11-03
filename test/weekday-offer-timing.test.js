import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekdayOfferTiming, weekdayIndex } from '../webapp/src/core/schedule.js';

// Game day numbers (days since 1970-01-01): 2026-11-02 is a Monday.
const MONDAY = Date.UTC(2026, 10, 2) / 86400000;
const day = (offset) => MONDAY + offset;

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
