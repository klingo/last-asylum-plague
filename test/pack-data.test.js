import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePackData, seasonalPassFamilies } from '../webapp/src/core/pack-data.js';
import { fitItemPoints } from '../webapp/src/core/point-fit.js';

const raw = {
    items: { diamonds: {}, gem: {}, coin: {} },
    packages: {
        gem_pack: { price: 100, deal_percentage: 1000, contains: { diamonds: 100, gem: 10 } },
    },
    exchange_shops: {
        shop: {
            currency_item_id: 'coin',
            offers: {
                complete: { item_id: 'gem', currency_cost: 50, quantity: 1, purchase_limit: 5, limit_type: 'weekly' },
                // Still being entered: no cost, quantity or limit.
                unfinished: { item_id: 'gem', limit_type: 'weekly' },
            },
        },
    },
};

test('normalize: an offer still without cost or quantity is left out, so it cannot spoil the fit', () => {
    const data = normalizePackData(raw);
    assert.deepEqual(Object.keys(data.exchange_shops.shop.offers), ['complete']);
    const fit = fitItemPoints(data);
    assert.ok(Number.isFinite(fit.diagnostics.medianError), 'the fit stays finite');
    assert.ok(fit.diagnostics.medianError < 1, 'and sane');
});

test('normalize: spend reward tracks without own conversions use the shared ones', () => {
    const shared = [
        { price: 99, points: 100 },
        { price: 499, points: 500 },
    ];
    const own = [{ price: 100, points: 300 }];
    const data = normalizePackData({
        spend_reward_conversions: shared,
        spend_reward_tracks: {
            standard: { tiers: { 1000: {} } },
            special: { conversions: own, tiers: { 1000: {} } },
            banknotes: { conversions: [], tiers: { 1000: {} } },
        },
    });
    assert.deepEqual(data.spend_reward_tracks.standard.conversions, shared);
    assert.deepEqual(data.spend_reward_tracks.special.conversions, own, 'its own list wins');
    assert.deepEqual(data.spend_reward_tracks.banknotes.conversions, [], '[] stays: 1 point per Banknote');
});

test('seasonal pass families: one per tier ladder, lowest tier first', () => {
    const packages = normalizePackData({
        packages: {
            gear_pass: { seasonal: true, tiers: { 2: { price: 999 }, 1: { price: 499 } } },
            tempered_pass: { seasonal: true, price: 99 },
            plain: { price: 1 },
        },
    }).packages;
    const families = seasonalPassFamilies(packages);
    assert.deepEqual([...families.keys()], ['gear_pass', 'tempered_pass']);
    assert.deepEqual(
        families.get('gear_pass').map(({ id }) => id),
        ['gear_pass_t1', 'gear_pass_t2'],
    );
    assert.equal(seasonalPassFamilies(undefined).size, 0);
});
