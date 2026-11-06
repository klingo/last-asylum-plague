import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandPackageFamilies } from '../../webapp/src/core/pack-data.js';
import {
    cheapestEventPackPrice,
    eventMaxSpend,
    eventPacksOnSale,
    isEventActive,
    isOnSale,
    isSeasonalOff,
    purchaseType,
    bundledPairs,
    packageWeeklyCapacity,
    offerWeeklyCapacity,
    capacityInWindow,
    currencyCost,
} from '../../webapp/src/core/catalog.js';

test('weekly capacity per limit type', () => {
    const pkg = (fields) => ({ price: 1, purchase_limit: 1, ...fields });
    assert.equal(packageWeeklyCapacity(pkg({ limit_type: 'daily' })), 7);
    assert.equal(packageWeeklyCapacity(pkg({ limit_type: 'daily', available_days: ['monday', 'friday'] })), 2);
    assert.equal(packageWeeklyCapacity(pkg({ limit_type: 'weekly', purchase_limit: 3 })), 3);
    assert.equal(packageWeeklyCapacity(pkg({ limit_type: 'biweekly' })), 0.5);
    assert.equal(packageWeeklyCapacity(pkg({ limit_type: 'monthly' })), 7 / 30);
    assert.equal(packageWeeklyCapacity(pkg({ purchase_limit: null })), Infinity);
});

test('availability: events, lifetime limits, passes', () => {
    const eventPack = { price: 1, purchase_limit: 2, limit_type: 'weekly', event_id: 'bazaar' };
    assert.equal(packageWeeklyCapacity(eventPack, { activeEventIds: new Set() }), 0);
    assert.equal(packageWeeklyCapacity(eventPack, { activeEventIds: new Set(['bazaar']) }), 2);
    assert.equal(packageWeeklyCapacity(eventPack), 2, 'no activeEventIds = every event active');

    const unlock = { price: 1, purchase_limit: 1, limit_type: 'lifetime' };
    assert.equal(packageWeeklyCapacity(unlock), 0);
    assert.equal(packageWeeklyCapacity(unlock, { includeExclusives: true }), 1);

    const pass = { price: 1, purchase_limit: 1, limit_type: 'monthly', delivery_days: 30 };
    assert.equal(packageWeeklyCapacity(pass, { includePasses: false }), 0);

    const shop = { event_id: 'bazaar' };
    const offer = { purchase_limit: 5, limit_type: 'daily' };
    assert.equal(offerWeeklyCapacity(offer, shop, { activeEventIds: new Set() }), 0);
    assert.equal(offerWeeklyCapacity(offer, shop, { activeEventIds: new Set(['bazaar']) }), 35);
});

test('seasonal passes and bundles', () => {
    const packages = expandPackageFamilies({
        gear_pass: { seasonal: true, tiers: { 1: { price: 499 }, 2: { price: 999 } } },
        weekly_pass: { bundles: ['hero_exp_pass'] },
        hero_exp_pass: {},
    });
    assert.equal(isSeasonalOff('gear_pass_t2', packages.gear_pass_t2, []), true);
    assert.equal(isSeasonalOff('gear_pass_t2', packages.gear_pass_t2, ['gear_pass']), false);
    assert.equal(isSeasonalOff('gear_pass_t2', packages.gear_pass_t2, undefined), false);
    assert.equal(isSeasonalOff('weekly_pass', packages.weekly_pass, []), false);
    assert.deepEqual(bundledPairs(packages), [['weekly_pass', 'hero_exp_pass']]);
});

test('capacity in a window of days (Compare)', () => {
    // Weekly limits reset on Monday: Sunday + Monday touches two weeks.
    assert.equal(capacityInWindow(1, 'weekly', { days: 2, startDay: 6 }), 2);
    assert.equal(capacityInWindow(1, 'weekly', { days: 7, startDay: 0 }), 1);
    // Daily limits count the open days inside the window.
    assert.equal(capacityInWindow(2, 'daily', { days: 7, startDay: 0, availableDays: ['tuesday', 'sunday'] }), 4);
    assert.equal(capacityInWindow(1, 'daily', { days: 3, startDay: 2, availableDays: ['monday'] }), 0);
    // Without a start day: proportional, rounded up.
    assert.equal(capacityInWindow(1, 'weekly', { days: 8 }), 2);
    assert.equal(capacityInWindow(1, 'daily', { days: 7, availableDays: ['monday', 'friday'] }), 2);
    // Event-tied limits never scale past one run; monthly per started 30 days; lifetime never scales.
    assert.equal(capacityInWindow(1, 'daily', { days: 30, eventTied: true }), 7);
    assert.equal(capacityInWindow(1, 'monthly', { days: 31 }), 2);
    assert.equal(capacityInWindow(3, 'lifetime', { days: 100 }), 3);
    assert.equal(capacityInWindow(null, 'weekly', { days: 7 }), Infinity);
});

test('currency cost: cheapest pack per coin first, within its weekly limit', () => {
    const packages = {
        cheap: { price: 500, event_id: 'mine', contains: { pick: 10 }, purchase_limit: 1, limit_type: 'daily' },
        dear: { price: 1000, event_id: 'mine', contains: { pick: 12 }, purchase_limit: 1, limit_type: 'daily' },
        other: { price: 100, event_id: 'other', contains: { pick: 100 }, purchase_limit: 1, limit_type: 'daily' },
    };
    const rules = { activeEventIds: new Set(['mine']) };
    assert.deepEqual(currencyCost(packages, 'pick', 30, rules), {
        banknotes: 1500,
        packIds: ['cheap'],
        available: 154,
    });
    // 70 from the cheap pack (7 days), the other 14 at 1000 / 12.
    const more = currencyCost(packages, 'pick', 84, rules);
    assert.ok(Math.abs(more.banknotes - (3500 + (14 * 1000) / 12)) < 1e-9);
    assert.deepEqual(more.packIds, ['cheap', 'dear']);
    assert.equal(currencyCost(packages, 'coin', 10, rules), null, 'no pack gives it');
    // 2 days of the run left: 20 + 24 pickaxes within the limits, the other 40 at the dearest rate.
    const late = currencyCost(packages, 'pick', 84, { ...rules, eventDaysLeft: { mine: 2 } });
    assert.equal(late.available, 44);
    assert.ok(Math.abs(late.banknotes - (1000 + 2000 + (40 * 1000) / 12)) < 1e-9);
});

const eventPackages = {
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
        eventPacksOnSale(eventPackages, 'e').map(({ id, limit }) => [id, limit]),
        [
            ['a', 2],
            ['b', 7],
        ],
        'priceless packs and other events are left out',
    );
    assert.deepEqual(eventPacksOnSale(eventPackages, 'nothing'), []);
});

test("the most an event's packs can take per week, and fewer days left cut the daily ones", () => {
    assert.equal(eventMaxSpend(eventPackages, 'e'), 2 * 100 + 7 * 500);
    assert.equal(eventMaxSpend(eventPackages, 'e', { eventDaysLeft: { e: 3 } }), 2 * 100 + 3 * 500);
    assert.equal(eventMaxSpend(eventPackages, 'nothing'), 0);
});

test("an event's cheapest pack", () => {
    assert.equal(cheapestEventPackPrice(eventPackages, 'e'), 100, 'a pack without a price is not on sale');
    assert.equal(cheapestEventPackPrice(eventPackages, 'nothing'), 0);
});

test('a package type follows the first rule that matches', () => {
    assert.equal(purchaseType({ category: 'diamond', event_id: 'e' }), 'top_up');
    assert.equal(purchaseType({ event_id: 'e', category: 'unlock_exclusive' }), 'event');
    assert.equal(purchaseType({ category: 'unlock_exclusive', limit_type: 'lifetime' }), 'unlock');
    assert.equal(purchaseType({ limit_type: 'lifetime' }), 'limited');
    assert.equal(purchaseType({ limit_type: 'monthly', delivery_days: 30 }), 'pass');
    assert.equal(purchaseType({ limit_type: 'monthly', delivery_days: 30, seasonal: true }), 'seasonal_pass');
    assert.equal(purchaseType({ limit_type: 'daily' }), 'package');
});

test('on sale: it has a price, its event runs and its seasonal pass is on', () => {
    const packages = expandPackageFamilies({
        plain: { price: 100 },
        free: { price: 0 },
        event_pack: { price: 100, event_id: 'bazaar' },
        gear_pass: { seasonal: true, tiers: { 1: { price: 499 } } },
    });
    const onSale = (id, rules) => isOnSale(id, packages[id], rules);
    assert.equal(onSale('plain'), true);
    assert.equal(onSale('free'), false, 'no price');
    assert.equal(onSale('event_pack', { activeEventIds: new Set() }), false);
    assert.equal(onSale('event_pack', { activeEventIds: new Set(['bazaar']) }), true);
    assert.equal(onSale('event_pack', { activeEventIds: null }), true, 'null: every event runs');
    assert.equal(onSale('gear_pass_t1', { seasonalPasses: [] }), false);
    assert.equal(onSale('gear_pass_t1', { seasonalPasses: ['gear_pass'] }), true);
    assert.equal(onSale('gear_pass_t1', {}), true, 'undefined: every pass is on');
});
