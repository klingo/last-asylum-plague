import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveWeeklyPlan } from '../webapp/src/core/planner.js';
import { fitItemPoints } from '../webapp/src/core/point-fit.js';
import { loadHighs } from '../webapp/src/core/lp.js';
import { DEFAULT_SETTINGS, priorityWeights } from '../webapp/src/ui/settings.js';
import { loadFixture } from './helpers.js';

// An event with no packs whose shop coin only comes from outside (Thief Hunt's lion coins: earned by killing thieves),
// on the frozen fixture. The shop sells the same item at two prices, so the cheaper one has to be bought first.
const data = structuredClone(loadFixture());
data.items.lion_coin = { name: { en: 'Lion Coin' }, category: 'event_item', rarity: 'ur' };
data.events.coin_hunt = { name: { en: 'Coin Hunt' }, category: 'special_event' };
data.exchange_shops.coin_hunt_shop = {
    name: { en: 'Coin Hunt Shop' },
    event_id: 'coin_hunt',
    currency_item_id: 'lion_coin',
    offers: {
        cheap: { item_id: 'raven_essence', currency_cost: 100, quantity: 1, purchase_limit: 1, limit_type: 'event' },
        dear: { item_id: 'raven_essence', currency_cost: 400, quantity: 1, purchase_limit: 1, limit_type: 'event' },
    },
};
const highs = await loadHighs();
const fit = fitItemPoints(data);
const plan = (coins) =>
    solveWeeklyPlan(highs, data, {
        budget: DEFAULT_SETTINGS.budget,
        activeEventIds: new Set(['coin_hunt']),
        seasonalPasses: [],
        lockedOffers: {},
        includePasses: true,
        includeExclusives: false,
        weights: priorityWeights(DEFAULT_SETTINGS),
        basePoints: fit.points,
        extraCurrency: { lion_coin: coins },
    });
const shopBuys = (result) =>
    result.exchanges.filter(({ shopId }) => shopId === 'coin_hunt_shop').map(({ offer }) => offer.currency_cost);

test('event coin shop: without coins nothing is bought', () => {
    assert.deepEqual(shopBuys(plan(0)), []);
});

test('event coin shop: the coins you enter go to the offer that gives the most per coin first', () => {
    assert.deepEqual(shopBuys(plan(100)), [100], 'only enough for the cheap one');
    assert.deepEqual(shopBuys(plan(399)), [100], 'the dear one needs 400');
});

test('event coin shop: with enough coins both are bought', () => {
    assert.deepEqual(
        shopBuys(plan(500)).sort((a, b) => a - b),
        [100, 400],
    );
});
