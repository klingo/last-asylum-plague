import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveWeeklyPlan } from '../../webapp/src/core/planner.js';
import { extraToLeaveAlone, lockSpendGap } from '../../webapp/src/core/event-plan.js';
import { loadHighs } from '../../webapp/src/core/lp.js';

// An event whose coin packs only matter for a shop offer ("bp", 5 points for 100 coins = one coin pack), next to a
// regular deal that is four times as good per Banknote. The event's extra Banknotes pay for its packs first.
const highs = await loadHighs();
const data = {
    items: { gem: {}, coin: {}, bp: {} },
    packages: {
        coin_pack: {
            price: 100,
            event_id: 'bazaar',
            contains: { coin: 100 },
            purchase_limit: 10,
            limit_type: 'weekly',
        },
        deal: { price: 100, contains: { gem: 20 }, purchase_limit: 10, limit_type: 'weekly' },
    },
    exchange_shops: {
        bazaar_shop: {
            event_id: 'bazaar',
            currency_item_id: 'coin',
            offers: {
                bp: { item_id: 'bp', currency_cost: 100, quantity: 1, purchase_limit: 10, limit_type: 'weekly' },
            },
        },
    },
};
const BASE_POINTS = new Map([
    ['gem', { value: 1, source: 'fit' }],
    ['bp', { value: 5, source: 'fit' }],
]);
const plan = (options = {}) =>
    solveWeeklyPlan(highs, data, {
        budget: 500,
        activeEventIds: new Set(['bazaar']),
        basePoints: BASE_POINTS,
        ...options,
    });
const bought = (result) => Object.fromEntries(result.purchases.map((p) => [p.id, p.count]));
const LOCK = { lockedOffers: { 'bazaar_shop:bp': 3 } };

test('event extra: without a lock the regular deal takes the whole weekly spend', () => {
    assert.deepEqual(bought(plan()), { deal: 5 });
});

test('event extra: a lock pays for its coin packs out of the weekly spend and pushes the deal out', () => {
    const locked = plan(LOCK);
    assert.deepEqual(bought(locked), { coin_pack: 3, deal: 2 });
    assert.equal(locked.regularSpent, 500);
    assert.deepEqual(locked.eventExtraUsed, {});
});

test('event extra: the extra Banknotes pay for the lock first, the deal keeps its spend', () => {
    const covered = plan({ ...LOCK, extraEventBanknotes: { bazaar: 300 } });
    assert.deepEqual(bought(covered), { coin_pack: 3, deal: 5 });
    assert.deepEqual(covered.eventExtraUsed, { bazaar: 300 });
    assert.equal(covered.spent, 800);
    assert.equal(covered.regularSpent, 500);
    const partly = plan({ ...LOCK, extraEventBanknotes: { bazaar: 100 } });
    assert.deepEqual(bought(partly), { coin_pack: 3, deal: 3 });
    assert.deepEqual(partly.eventExtraUsed, { bazaar: 100 });
});

test('event extra: without a lock the extra goes into the event packs that give something', () => {
    const extra = plan({ extraEventBanknotes: { bazaar: 1000 } });
    assert.deepEqual(bought(extra), { coin_pack: 10, deal: 5 });
    assert.deepEqual(extra.eventExtraUsed, { bazaar: 1000 });
    // More than the packs can take: only what they take is used.
    assert.deepEqual(plan({ extraEventBanknotes: { bazaar: 5000 } }).eventExtraUsed, { bazaar: 1000 });
});

test("event extra: another event's extra Banknotes do not pay for these packs", () => {
    const other = plan({ ...LOCK, extraEventBanknotes: { elsewhere: 300 } });
    assert.deepEqual(bought(other), { coin_pack: 3, deal: 2 });
    assert.deepEqual(other.eventExtraUsed, { elsewhere: 0 });
});

test('event extra: the rate stays the weekly spend’s last Banknote, whatever the extra buys', () => {
    assert.equal(plan({ extraEventBanknotes: { bazaar: 1000 } }).rate, plan().rate);
});

test('lock spend gap: what the locks take from the other packs, the extra that gives it back', () => {
    const baseline = plan();
    assert.equal(lockSpendGap(plan(LOCK), baseline, 'bazaar'), 300);
    assert.equal(lockSpendGap(plan({ ...LOCK, extraEventBanknotes: { bazaar: 100 } }), baseline, 'bazaar'), 200);
    assert.equal(lockSpendGap(plan({ ...LOCK, extraEventBanknotes: { bazaar: 300 } }), baseline, 'bazaar'), 0);
    assert.equal(lockSpendGap(baseline, baseline, 'bazaar'), 0, 'never negative, 0 without locks');
});

test('extra to leave the others alone: the same figure whatever extra is set, even if the lock is out of reach', () => {
    // A weekly spend of 200 can't pay the lock's 300 of coin packs: 2 of 3 are bought, nothing is left for the deal.
    const options = { ...LOCK, budget: 200 };
    const baseline = plan({ budget: 200 });
    const solveWith = (extra) => plan({ ...options, extraEventBanknotes: { bazaar: extra } });
    for (const extra of [0, 100, 200]) {
        const result = extraToLeaveAlone({
            eventId: 'bazaar',
            baseline,
            current: solveWith(extra),
            extra,
            solve: solveWith,
        });
        assert.equal(result.needed, 300, `from an extra of ${extra}`);
        assert.equal(lockSpendGap(solveWith(result.needed), baseline, 'bazaar'), 0, 'and it leaves nothing taken');
    }
    const none = extraToLeaveAlone({
        eventId: 'bazaar',
        baseline,
        current: solveWith(300),
        extra: 300,
        solve: solveWith,
    });
    assert.deepEqual(none, { taken: 0, needed: 300 }, 'nothing taken: the extra stays as set');
});

test('extra to leave the others alone: never asks for more than the event can take, nor solves beyond it', () => {
    const options = { ...LOCK, budget: 200 };
    const baseline = plan({ budget: 200 });
    const asked = [];
    const solveWith = (extra) => {
        asked.push(extra);
        return plan({ ...options, extraEventBanknotes: { bazaar: extra } });
    };
    const result = extraToLeaveAlone({
        eventId: 'bazaar',
        baseline,
        current: solveWith(0),
        extra: 0,
        maxExtra: 250,
        solve: solveWith,
    });
    assert.equal(result.needed, 250, 'capped at what the packs can take (the lock itself needs 300)');
    assert.ok(Math.max(...asked) <= 250, `solved only up to the cap: ${asked}`);
});
