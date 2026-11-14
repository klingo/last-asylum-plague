import { storage } from './env.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { wireCollapsible } from '../../webapp/src/ui/collapsible.js';
import { STORAGE_KEYS } from '../../webapp/src/ui/storage.js';

// A <details data-section>: the toggle listeners it got, its open state and what wireCollapsible marks it with.
function fakeDetails(section) {
    const details = { dataset: { section }, open: true, listeners: [] };
    details.addEventListener = (type, listener) => details.listeners.push([type, listener]);
    details.toggle = (open) => {
        details.open = open;
        details.listeners.forEach(([, listener]) => listener());
    };
    return details;
}

const rootOf = (...cards) => ({ querySelectorAll: (selector) => (selector === 'details[data-section]' ? cards : []) });
const saved = () => JSON.parse(storage.get(STORAGE_KEYS.collapsedSections));

beforeEach(() => storage.clear());

test('collapsible: a card starts open, or collapsed when it was saved so', () => {
    storage.set(STORAGE_KEYS.collapsedSections, JSON.stringify({ rotation: true }));
    const [schedule, rotation] = [fakeDetails('schedule'), fakeDetails('rotation')];
    wireCollapsible(rootOf(schedule, rotation));
    assert.equal(schedule.open, true);
    assert.equal(rotation.open, false);
});

test('collapsible: toggling a card saves it, opening it again forgets it', () => {
    const [schedule, rotation] = [fakeDetails('schedule'), fakeDetails('rotation')];
    wireCollapsible(rootOf(schedule, rotation));
    schedule.toggle(false);
    rotation.toggle(false);
    assert.deepEqual(saved(), { schedule: true, rotation: true });
    schedule.toggle(true);
    assert.deepEqual(saved(), { rotation: true });
});

test('collapsible: wiring a card again (the page draws it again) adds no second listener', () => {
    const card = fakeDetails('schedule');
    wireCollapsible(rootOf(card));
    wireCollapsible(rootOf(card));
    assert.equal(card.listeners.length, 1);
});
