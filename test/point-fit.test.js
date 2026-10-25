import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitItemPoints } from '../webapp/src/core/point-fit.js';

// Two packs that pin down VIP points and gems exactly: 1'000 = 100 + 100 vip + 10 gem, 500 = 100 + 200 vip.
const data = {
    items: { diamonds: {}, vip_points: {}, gem: {} },
    packages: {
        gem_pack: { price: 100, deal_percentage: 1000, contains: { diamonds: 100, vip_points: 100, gem: 10 } },
        vip_pack: { price: 100, deal_percentage: 500, contains: { diamonds: 100, vip_points: 200 } },
    },
    exchange_shops: {},
};

const near = (actual, expected) =>
    assert.ok(Math.abs(actual / expected - 1) < 0.05, `${actual} != ${expected} (within 5%: the fit's weak ridge)`);

test('fit: VIP points take their share of the deal %, unless left out ("Count VIP points" off)', () => {
    const counted = fitItemPoints(data).points;
    near(counted.get('vip_points').value, 2);
    near(counted.get('gem').value, 70);

    // Worth 0: the gem pack's whole deal % (minus its diamonds) is carried by the gems.
    const zero = fitItemPoints(data, { zeroItems: new Set(['vip_points']) }).points;
    assert.deepEqual(zero.get('vip_points'), { value: 0, source: 'excluded' });
    near(zero.get('gem').value, 90);
});
