import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotationSlots, rotationWindow } from '../webapp/src/core/schedule.js';

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
const weekStart = Date.UTC(2026, 10, 1, 2);
const slotAt = (hours) => weekStart + hours * HOUR;
const names = ({ current, next }) => [current.phase.name.en, next.phase.name.en];

test('rotation: the week list fills the week', () => {
    assert.equal(rotation.week.length * rotation.hours, 7 * 24);
});

test('rotation: the week starts with its first slot at Sunday 02:00 UTC', () => {
    const { current, next } = rotationSlots(rotation, weekStart);
    assert.deepEqual(names({ current, next }), ['Territory', 'Soldiers']);
    assert.equal(current.start, weekStart);
    assert.equal(current.end, weekStart + 4 * HOUR);
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
    assert.equal(current.end, weekStart + 7 * 24 * HOUR);
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
    assert.equal(slots[wrap].start, weekStart + 7 * 24 * HOUR);
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
    assert.equal(slots[0].start, weekStart);
    assert.equal(slots[2].end, slotAt(12));
});
