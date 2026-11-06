import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    activeLocks,
    eventItemTotals,
    eventSelection,
    hasOutsideCurrency,
    withLock,
} from '../../webapp/src/core/event-plan.js';

const data = {
    events: { bazaar: {}, mine_event: {}, plain: {} },
    exchange_shops: {
        bazaar_shop: { event_id: 'bazaar', currency_item_id: 'coin', offers: {} },
        vip_shop: { currency_item_id: 'diamonds', offers: {} },
        hunt_shop: { event_id: 'plain', currency_item_id: 'lion', offers: {} },
    },
    mines: { the_mine: { event_id: 'mine_event', currency_item_id: 'pickaxe' } },
    packages: {
        bazaar_pack: { event_id: 'bazaar', contains: { coin: 100 } },
        plain_pack: { event_id: 'plain', contains: { gem: 1 } },
    },
};

test('a tab stands for an event with its shop and mine, or for a shop without event', () => {
    assert.deepEqual(eventSelection(data, 'event:bazaar'), {
        eventId: 'bazaar',
        shopId: 'bazaar_shop',
        shop: data.exchange_shops.bazaar_shop,
        mineId: null,
        mine: null,
    });
    const mine = eventSelection(data, 'event:mine_event');
    assert.equal(mine.mineId, 'the_mine');
    assert.equal(mine.shopId, null);
    assert.deepEqual(eventSelection(data, 'shop:vip_shop'), {
        eventId: null,
        shopId: 'vip_shop',
        shop: data.exchange_shops.vip_shop,
    });
    assert.equal(eventSelection(data, 'event:nope'), null);
    assert.equal(eventSelection(data, 'shop:nope'), null);
    assert.equal(eventSelection(data, ''), null);
});

test('a shop whose currency also comes from outside the packs', () => {
    const { packages, exchange_shops: shops } = data;
    assert.equal(hasOutsideCurrency(packages, shops.vip_shop), true, 'no event: diamonds come from elsewhere too');
    assert.equal(hasOutsideCurrency(packages, shops.bazaar_shop), false, 'a pack gives the coin');
    assert.equal(hasOutsideCurrency(packages, shops.hunt_shop), true, 'no pack of the event gives lion coins');
    assert.equal(hasOutsideCurrency(packages, null), false);
});

test('locks: set, change, unset (a new object each time); only those of a running event count', () => {
    const none = {};
    const one = withLock(none, 'vip_shop', 'gem', 2);
    assert.deepEqual(one, { 'vip_shop:gem': 2 });
    assert.deepEqual(none, {}, 'the old object is left alone');
    assert.deepEqual(withLock(one, 'vip_shop', 'gem', 0), { 'vip_shop:gem': 0 }, '0 = never buy');
    assert.deepEqual(withLock(one, 'vip_shop', 'gem', null), {});

    const locks = { 'vip_shop:gem': 1, 'bazaar_shop:x': 1, 'hunt_shop:y': 1, 'gone_shop:z': 1 };
    assert.deepEqual(activeLocks(locks, data.exchange_shops, ['bazaar']), ['vip_shop:gem', 'bazaar_shop:x']);
    assert.deepEqual(activeLocks(undefined, data.exchange_shops, []), []);
});

test('everything the plan gets from an event, sorted by worth', () => {
    const plan = {
        purchases: [
            { pkg: { event_id: 'bazaar' }, count: 2 },
            { pkg: { event_id: 'other' }, count: 5 },
        ],
        exchanges: [
            { shopId: 'bazaar_shop', offer: { item_id: 'hat', quantity: 3 }, count: 2 },
            { shopId: 'other_shop', offer: { item_id: 'ignored', quantity: 1 }, count: 1 },
        ],
        tiersReached: [{ shopId: 'bazaar_shop', reward: { ticket: 4 } }],
        pointPurchases: [{ shopId: 'bazaar_shop', count: 2 }],
    };
    const shop = {
        currency_item_id: 'coin',
        point_purchase: { currency_item_id: 'diamonds', currency_cost: 100 },
    };
    const worth = { gem: 1, hat: 10, ticket: 0.5, diamonds: 0.1, coin: 99 };
    const totals = eventItemTotals(
        plan,
        { eventId: 'bazaar', shopId: 'bazaar_shop', shop, mine: null, dug: null },
        {
            partsOf: () => [
                { id: 'gem', qty: 5 },
                { id: 'coin', qty: 100 },
            ],
            worthOf: (id) => worth[id] ?? null,
        },
    );
    // 2 packs x (5 gems, 100 coins); 2 offers x 3 hats; the tier's tickets; the Encounters cost 2 x 100 diamonds.
    // The shop's coins are spent there, so they are left out.
    assert.deepEqual(totals, [
        { id: 'hat', qty: 6, worth: 60 },
        { id: 'gem', qty: 10, worth: 10 },
        { id: 'ticket', qty: 4, worth: 2 },
        { id: 'diamonds', qty: -200, worth: -20 },
    ]);
});

test('a dug mine adds its loot, wishes and progress rewards; the pickaxes are left out', () => {
    const mine = { currency_item_id: 'pickaxe', progress_rewards: { 5: { gem: 2 } } };
    const dug = {
        normalRewards: { gem: 1.5, pickaxe: 3 },
        wishes: [
            { reward: { hat: 1 }, count: 2 },
            { reward: { crown: 1 }, count: 0 },
        ],
        progressReached: [5],
    };
    const plan = { purchases: [], exchanges: [], tiersReached: [], pointPurchases: [] };
    const totals = eventItemTotals(
        plan,
        { eventId: 'mine_event', shopId: null, shop: null, mine, dug },
        { partsOf: () => [], worthOf: () => 1 },
    );
    assert.deepEqual(totals.map(({ id, qty }) => [id, qty]).sort(), [
        ['gem', 3.5],
        ['hat', 2],
    ]);
});
