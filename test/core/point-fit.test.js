import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitItemPoints, fitHoldOut, fitSensitivity, isDependent } from '../../webapp/src/core/point-fit.js';
import { near } from '../helpers.js';

// Two packs that pin down VIP points and gems exactly: 1'000 = 100 + 100 vip + 10 gem, 500 = 100 + 200 vip.
const data = {
    items: { diamonds: {}, vip_points: {}, gem: {} },
    packages: {
        gem_pack: { price: 100, deal_percentage: 1000, contains: { diamonds: 100, vip_points: 100, gem: 10 } },
        vip_pack: { price: 100, deal_percentage: 500, contains: { diamonds: 100, vip_points: 200 } },
    },
    exchange_shops: {},
};

// Within 5 % (the fit's weak ridge).
const near5 = (actual, expected) => near(actual, expected, { relative: 0.05 });

test('fit: VIP points take their share of the deal %, unless left out ("Count VIP points" off)', () => {
    const counted = fitItemPoints(data).points;
    near5(counted.get('vip_points').value, 2);
    near5(counted.get('gem').value, 70);

    // Worth 0: the gem pack's whole deal % (minus its diamonds) is carried by the gems.
    const zero = fitItemPoints(data, { zeroItems: new Set(['vip_points']) }).points;
    assert.deepEqual(zero.get('vip_points'), { value: 0, source: 'excluded' });
    near5(zero.get('gem').value, 90);
});

test('hold-out: a pack the others explain is predicted, one with an item nobody else has is skipped', () => {
    const three = {
        ...data,
        packages: {
            ...data.packages,
            vip_pack_2: { price: 100, deal_percentage: 400, contains: { diamonds: 100, vip_points: 150 } },
        },
    };
    const heldOut = fitHoldOut(three, fitItemPoints(three));
    const ids = heldOut.map((p) => p.id);
    assert.ok(!ids.includes('gem_pack'), 'the gem is in no other pack');
    near5(heldOut.find((p) => p.id === 'vip_pack_2').ratio, 1);
});

test("sensitivity: the refits keep the fit's own settings (VIP points at 0 stay at 0)", () => {
    const three = {
        ...data,
        packages: {
            ...data.packages,
            vip_pack_2: { price: 100, deal_percentage: 400, contains: { diamonds: 100, vip_points: 150 } },
        },
    };
    const base = fitItemPoints(three, { zeroItems: new Set(['vip_points']) });
    assert.deepEqual(base.zeroItems, new Set(['vip_points']), 'the fit says how it was made');
    // With VIP points at 0, a VIP pack says nothing about gems: leaving it out mustn't move them.
    const gem = fitSensitivity(three, base, { families: ['vip_pack'] }).get('gem');
    assert.ok(gem.factor < 1.05, `gems moved ×${gem.factor.toFixed(2)} without a VIP pack`);
});

test('an item hinges on a pack when the fit moves a lot without it', () => {
    assert.equal(isDependent(undefined), false);
    assert.equal(isDependent({ factor: 1.1, family: 'a' }), false);
    assert.equal(isDependent({ factor: Infinity, family: 'a' }), true, 'no value at all without the pack');
});
