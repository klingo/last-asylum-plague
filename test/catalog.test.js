import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandPackageFamilies, packageFamilyId } from '../webapp/src/core/pack-data.js';
import {
    isSeasonalOff,
    bundledPairs,
    packageWeeklyCapacity,
    offerWeeklyCapacity,
    capacityInWindow,
    currencyCost,
} from '../webapp/src/core/catalog.js';

test('tier ladders expand into one package per tier, each requiring the one below', () => {
    const packages = expandPackageFamilies({
        shard: { name: { en: 'Shard' }, limit_type: 'daily', tiers: { 2: { price: 999 }, 1: { price: 499 } } },
        single: { price: 99 },
    });
    assert.deepEqual(Object.keys(packages), ['shard_t1', 'shard_t2', 'single']);
    assert.equal(packages.shard_t1.requires, null);
    assert.equal(packages.shard_t2.requires, 'shard_t1');
    assert.equal(packages.shard_t2.price, 999);
    assert.equal(packages.shard_t2.limit_type, 'daily');
    assert.equal(packageFamilyId('shard_t2', packages.shard_t2), 'shard');
    // Expanding again changes nothing.
    assert.deepEqual(expandPackageFamilies(packages), packages);
});

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
    const unlimited = currencyCost(packages, 'pick', 84, { ...rules, exceedEventPackLimits: new Set(['mine']) });
    assert.deepEqual(
        unlimited,
        { banknotes: 84 * 50, packIds: ['cheap'], available: Infinity },
        'limits lifted: all from the cheap pack',
    );
    // 2 days of the run left: 20 + 24 pickaxes within the limits, the other 40 at the dearest rate.
    const late = currencyCost(packages, 'pick', 84, { ...rules, eventDaysLeft: { mine: 2 } });
    assert.equal(late.available, 44);
    assert.ok(Math.abs(late.banknotes - (1000 + 2000 + (40 * 1000) / 12)) < 1e-9);
});
