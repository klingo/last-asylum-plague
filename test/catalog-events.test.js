import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cheapestEventPackPrice, eventMaxSpend, eventPacksOnSale, isEventActive } from '../webapp/src/core/catalog.js';

const packages = {
    a: { price: 100, event_id: 'e', purchase_limit: 2, limit_type: 'weekly' },
    b: { price: 500, event_id: 'e', purchase_limit: 1, limit_type: 'daily' },
    free: { price: 0, event_id: 'e', purchase_limit: 1, limit_type: 'weekly' },
    elsewhere: { price: 50, event_id: 'other', purchase_limit: 1, limit_type: 'weekly' },
    plain: { price: 10, purchase_limit: 1, limit_type: 'weekly' },
};

test('an event is running unless a set of running events leaves it out', () => {
    assert.equal(isEventActive('e', null), true, 'no set: every event runs');
    assert.equal(isEventActive('e', new Set(['e'])), true);
    assert.equal(isEventActive('e', new Set(['other'])), false);
});

test("an event's packs on sale, with how often each can be bought per week", () => {
    assert.deepEqual(
        eventPacksOnSale(packages, 'e').map(({ id, limit }) => [id, limit]),
        [
            ['a', 2],
            ['b', 7],
        ],
        'priceless packs and other events are left out',
    );
    assert.deepEqual(eventPacksOnSale(packages, 'nothing'), []);
});

test("the most an event's packs can take per week, and fewer days left cut the daily ones", () => {
    assert.equal(eventMaxSpend(packages, 'e'), 2 * 100 + 7 * 500);
    assert.equal(eventMaxSpend(packages, 'e', { eventDaysLeft: { e: 3 } }), 2 * 100 + 3 * 500);
    assert.equal(eventMaxSpend(packages, 'nothing'), 0);
});

test("an event's cheapest pack", () => {
    assert.equal(cheapestEventPackPrice(packages, 'e'), 100, 'a pack without a price is not on sale');
    assert.equal(cheapestEventPackPrice(packages, 'nothing'), 0);
});
