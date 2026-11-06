import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveNeeds } from '../../webapp/src/core/acquire.js';
import { loadHighs } from '../../webapp/src/core/lp.js';

const highs = await loadHighs();

// A pack sells 100 coins for 100 Banknotes (up to 7 a week); a shop sells a gem for 100 coins. The coin shop may
// also hand out coins for free: 10 an hour, so 1680 in 7 days.
const data = (income) => ({
    items: { gem: {}, coin: {} },
    packages: { coin_pack: { price: 100, contains: { coin: 100 }, purchase_limit: 7, limit_type: 'weekly' } },
    exchange_shops: {
        coin_shop: {
            currency_item_id: 'coin',
            ...(income ? { income_per_hour: income } : {}),
            offers: {
                gem: { item_id: 'gem', currency_cost: 100, quantity: 1, purchase_limit: 1000, limit_type: 'weekly' },
            },
        },
    },
});
const solve = (shopData, needs, options = {}) =>
    solveNeeds(highs, shopData, new Map(Object.entries(needs)), { days: 7, ...options });

test('without free income the coins are paid for with packs', () => {
    const result = solve(data(0), { gem: 5 });
    assert.equal(result.reachable, true);
    assert.equal(result.totalCost, 500);
});

test("a shop's free income (income_per_hour) covers coins within the window", () => {
    const covered = solve(data(10), { gem: 5 });
    assert.equal(covered.totalCost, 0);
    assert.equal(covered.offers[0].count, 5);

    // 20 gems need 2000 coins: 1680 are free, 4 packs bring the other 320.
    const partly = solve(data(10), { gem: 20 });
    assert.equal(partly.totalCost, 400);
    assert.equal(partly.packages[0].count, 4);

    // Fewer days, less income: 3 days give 720 coins.
    assert.equal(solve(data(10), { gem: 10 }, { days: 3 }).totalCost, 300);
});

test('free income covers a need for the coin itself, but only up to what it gives', () => {
    assert.equal(solve(data(10), { coin: 1000 }).totalCost, 0);
    assert.equal(solve(data(10), { coin: 2000 }).totalCost, 400);
    // 1680 free + 7 packs of 100 at most.
    assert.equal(solve(data(10), { coin: 5000 }).reachable, false);
});

test('free income only counts while its shop is available', () => {
    const shops = data(0);
    shops.exchange_shops.event_shop = { event_id: 'feast', currency_item_id: 'coin', income_per_hour: 10, offers: {} };
    assert.equal(solve(shops, { gem: 5 }, { activeEventIds: new Set() }).totalCost, 500);
    assert.equal(solve(shops, { gem: 5 }, { activeEventIds: new Set(['feast']) }).totalCost, 0);
});

test('unused free currency is no by-product, and the free coins spent are no loss', () => {
    // 5 gems use 500 of the 1680 free coins: nothing is left over from the plan, whatever a coin is worth.
    const worthOf = (id) => (id === 'coin' ? 1 : 0);
    assert.equal(solve(data(10), { gem: 5 }, { worthOf }).byproductWorth, 0);
});

test('with two packs for the same coin the cheaper one per coin is bought first, within its limit', () => {
    const shops = data(0);
    shops.packages.big_pack = { price: 300, contains: { coin: 400 }, purchase_limit: 1, limit_type: 'weekly' };
    // 5 gems need 500 coins: the big pack (400 for 300) first, 100 more from a cheap one.
    const result = solve(shops, { gem: 5 });
    assert.equal(result.totalCost, 400);
    assert.deepEqual(result.packages.map(({ id, count }) => [id, count]).sort(), [
        ['big_pack', 1],
        ['coin_pack', 1],
    ]);
});

test('what no source or no purchase limit can deliver is unreachable, not free', () => {
    assert.equal(solve(data(0), { nothing_gives_this: 1 }).reachable, false);
    assert.equal(solve(data(0), { gem: 8 }).reachable, false, '8 gems need 800 coins, the pack gives 700 a week');
    assert.equal(solve(data(0), { gem: 8 }, { days: 14 }).reachable, true, 'two weeks have two weekly limits');
});

test('a pack of an event that is not running is not available', () => {
    const shops = data(0);
    shops.packages.coin_pack.event_id = 'feast';
    assert.equal(solve(shops, { gem: 5 }, { activeEventIds: new Set() }).reachable, false);
    assert.equal(solve(shops, { gem: 5 }, { activeEventIds: new Set(['feast']) }).totalCost, 500);
});
