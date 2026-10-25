import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePackData } from '../webapp/src/core/pack-data.js';
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
