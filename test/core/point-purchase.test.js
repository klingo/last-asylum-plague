import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveWeeklyPlan } from '../../webapp/src/core/planner.js';
import { fitItemPoints } from '../../webapp/src/core/point-fit.js';
import { loadHighs } from '../../webapp/src/core/lp.js';
import { loadFixture, defaultPlanOptions } from '../helpers.js';

// The Surprise Encounter shop of the frozen fixture with an Encounter that gives a lot (so that buying one always
// pays), a free one every day and a limit per run that counts the free ones too.
const highs = await loadHighs();
const shopWith = (pointPurchase) => {
    const data = structuredClone(loadFixture());
    Object.assign(data.exchange_shops.surprise_encounter_shop.point_purchase, pointPurchase);
    return data;
};
const plan = (pointPurchase, overrides = {}) => {
    const data = shopWith(pointPurchase);
    const options = defaultPlanOptions(fitItemPoints(data), {
        activeEventIds: new Set(['surprise_encounter']),
        budget: 0,
        ...overrides,
    });
    return solveWeeklyPlan(highs, data, options);
};
const encounters = (result) => result.pointPurchases.find(({ shopId }) => shopId === 'surprise_encounter_shop');
const reward = { rolls: [[{ contains: { ur_hero_omni_shard: 2000 }, probability: 0.5 }]] };

test('Encounters: the free ones of every day are always taken, even without diamonds', () => {
    const { count, free } = encounters(plan({ ...reward, free_per_day: 1 }));
    assert.deepEqual({ count, free }, { count: 0, free: 7 });
});

test('Encounters: only the days left of the event give a free one', () => {
    const result = plan({ ...reward, free_per_day: 1 }, { eventDaysLeft: { surprise_encounter: 3 } });
    assert.equal(encounters(result).free, 3);
});

test('Encounters: the bought ones stop where the limit of the run, free ones included, is reached', () => {
    const result = plan(
        { ...reward, free_per_day: 1, purchase_limit: 10, limit_type: 'event' },
        { extraCurrency: { diamonds: 100000 } },
    );
    const { count, free } = encounters(result);
    assert.deepEqual({ count, free }, { count: 3, free: 7 });
});

test('Encounters: a limit below the free ones cuts the free ones too', () => {
    const result = plan({ ...reward, free_per_day: 1, purchase_limit: 5, limit_type: 'event' });
    assert.deepEqual({ count: encounters(result).count, free: encounters(result).free }, { count: 0, free: 5 });
});

test('Encounters: the free ones earn progress points towards the bonus tiers', () => {
    const tiers = (result) => result.tiersReached.filter(({ shopId }) => shopId === 'surprise_encounter_shop');
    assert.equal(tiers(plan({})).length, 0, 'no Encounter, no progress');
    // 15 free a day x 7 days x 10 points = 1'050 points: the 100, 500 and 1000 tiers.
    const result = plan({ free_per_day: 15 });
    assert.deepEqual(
        tiers(result).map(({ threshold }) => threshold),
        [100, 500, 1000],
    );
});

test('Encounters: the diamonds you enter pay for them, and no more than you enter', () => {
    const { count } = encounters(plan({ ...reward }, { extraCurrency: { diamonds: 350 } }));
    assert.equal(count, 3, '350 diamonds buy 3 Encounters of 100');
});
