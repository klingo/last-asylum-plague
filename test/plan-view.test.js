import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandPackageFamilies } from '../webapp/src/core/pack-data.js';
import { groupPlanByWhen, notBoughtReasons, plannedPurchases } from '../webapp/src/core/plan-view.js';

test('purchases per period: whole numbers, monthly and biweekly packs per period, at least one', () => {
    assert.equal(plannedPurchases({ limit_type: 'weekly', purchase_limit: 3 }, 3), 3);
    assert.equal(plannedPurchases({ limit_type: 'daily', purchase_limit: 1 }, 7), 7);
    // A monthly pass counts a weekly share of 7/30 in the plan: one purchase per month.
    assert.equal(plannedPurchases({ limit_type: 'monthly', purchase_limit: 1 }, 7 / 30), 1);
    assert.equal(plannedPurchases({ limit_type: 'biweekly', purchase_limit: 1 }, 0.5), 1);
    assert.equal(plannedPurchases({ limit_type: 'weekly', purchase_limit: 1 }, 0.2), 1, 'never below one');
});

test('the plan by when to buy it', () => {
    const pack = (fields) => ({ price: 1, purchase_limit: 7, ...fields });
    const plan = {
        purchases: [
            { pkg: pack({ limit_type: 'daily' }), count: 7, spend: 7 },
            { pkg: pack({ limit_type: 'weekly', purchase_limit: 2 }), count: 2, spend: 2 },
            // A weekday offer on Wednesday and Friday, on Monday: still ahead this week.
            {
                pkg: pack({
                    category: 'weekly_rotation',
                    limit_type: 'weekly',
                    available_days: ['wednesday', 'friday'],
                }),
                count: 1,
                spend: 1,
            },
            { pkg: pack({ event_id: 'bazaar', limit_type: 'weekly' }), count: 3, spend: 3 },
        ],
        exchanges: [{ shopId: 'bazaar_shop' }, { shopId: 'bazaar_shop' }, { shopId: 'vip_shop' }],
    };
    const data = { exchange_shops: { bazaar_shop: { event_id: 'bazaar' }, vip_shop: {} } };
    const monday = Date.UTC(2026, 10, 2) / 86400000;
    const grouped = groupPlanByWhen(plan, data, monday);
    assert.deepEqual(
        grouped.daily.map(({ planned, spend }) => [planned, spend]),
        [[7, 7]],
    );
    assert.deepEqual(
        grouped.weekly.map(({ planned, spend }) => [planned, spend]),
        [[2, 2]],
    );
    assert.deepEqual(
        grouped.rotation.map(({ timing }) => timing),
        [{ state: 'upcoming', days: 2 }],
    );
    assert.equal(grouped.byEvent.get('bazaar').packs.length, 1);
    assert.equal(grouped.byEvent.get('bazaar').offers, 2, 'the different offers of the event shop');
    assert.deepEqual([...grouped.standing], [['vip_shop', 1]]);
});

test('why the plan leaves a pack out: a bundle that includes it, or the pick of its group', () => {
    const packages = expandPackageFamilies({
        weekly_pass: { bundles: ['single_pass'] },
        single_pass: {},
        gift_a: { exclusive_group: 'gifts' },
        gift_b: { exclusive_group: 'gifts' },
        other: {},
    });
    const reasons = notBoughtReasons(
        packages,
        new Map([
            ['weekly_pass', 1],
            ['gift_a', 1],
        ]),
    );
    assert.deepEqual(reasons.get('single_pass'), { kind: 'bundle', causeId: 'weekly_pass' });
    assert.deepEqual(reasons.get('gift_b'), { kind: 'group', causeId: 'gift_a' });
    assert.equal(reasons.has('gift_a'), false, 'the pick itself is bought');
    assert.equal(reasons.has('other'), false);
    assert.equal(notBoughtReasons(packages, new Map()).size, 0);
});
