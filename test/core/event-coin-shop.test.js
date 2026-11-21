import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveWeeklyPlan } from '../../webapp/src/core/planner.js';
import { fitItemPoints } from '../../webapp/src/core/point-fit.js';
import { loadHighs } from '../../webapp/src/core/lp.js';
import { offerPurchaseCost } from '../../webapp/src/core/event-plan.js';
import { loadFixture, defaultPlanOptions, near } from '../helpers.js';

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
    solveWeeklyPlan(
        highs,
        data,
        defaultPlanOptions(fit, { activeEventIds: new Set(['coin_hunt']), extraCurrency: { lion_coin: coins } }),
    );
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

// Coins from outside with two offers for the same price: the one that gives more is bought, so one more purchase of the
// other costs what the better one is worth (its coins have no other use), whatever its own item is worth.
const swap = structuredClone(data);
swap.items.swap_coin = { name: { en: 'Swap Coin' }, category: 'event_item', rarity: 'ur' };
swap.events.swap_hunt = { name: { en: 'Swap Hunt' }, category: 'special_event' };
swap.exchange_shops.swap_shop = {
    name: { en: 'Swap Shop' },
    event_id: 'swap_hunt',
    currency_item_id: 'swap_coin',
    offers: {
        strong: { item_id: 'raven_essence', currency_cost: 100, quantity: 3, purchase_limit: 1, limit_type: 'event' },
        weak: { item_id: 'raven_essence', currency_cost: 100, quantity: 1, purchase_limit: 1, limit_type: 'event' },
    },
};
const swapFit = fitItemPoints(swap);
const swapPlan = (lockedOffers) =>
    solveWeeklyPlan(
        highs,
        swap,
        defaultPlanOptions(swapFit, {
            activeEventIds: new Set(['swap_hunt']),
            extraCurrency: { swap_coin: 100 },
            lockedOffers,
        }),
    );

test('offer price: one more of the weaker offer costs the better offer it pushes out', () => {
    const plan = swapPlan({});
    assert.deepEqual(
        plan.exchanges.filter(({ shopId }) => shopId === 'swap_shop').map(({ offerKey }) => offerKey),
        ['strong'],
    );
    const worthOf = (quantity) => plan.bundlePoints({ contains: { raven_essence: quantity } }).value / plan.rate;
    const price = (offerKey, quantity) =>
        offerPurchaseCost({
            plan,
            shopId: 'swap_shop',
            offerKey,
            offerWorth: worthOf(quantity),
            capacity: 1,
            lockedOffers: {},
            solve: swapPlan,
        });
    near(price('weak', 1).banknotes, worthOf(3), { relative: 1e-6 });
    // The better offer's last purchase gives its coins back to nothing: only the weaker one could use them.
    near(price('strong', 3).banknotes, worthOf(1), { relative: 1e-6 });
    assert.equal(price('strong', 3).last, true);
});
