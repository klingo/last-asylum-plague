import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    targetFloor,
    freeCurrency,
    expectedDigs,
    pickaxeOdds,
    floorsFor,
    mineSegments,
    normalRewardBundle,
} from '../webapp/src/core/mine.js';
import { solveWeeklyPlan } from '../webapp/src/core/planner.js';
import { loadHighs } from '../webapp/src/core/lp.js';

// The Dwarven Mine's rules: 12 tiles (1 wish), normal weight 10, the wish's weight rising with the digs done.
const RULES = {
    tiles_per_floor: 12,
    normal_weight: 10,
    special_weights: { 0: 1, 3: 5, 6: 10, 9: 30 },
    pity: { 0: 10, 1: 5, 2: 6, 3: 8, 4: 5, 5: 10, 6: 5, 7: 6, 8: 8, 9: 5 },
};

const near = (actual, expected, digits = 3) =>
    assert.ok(Math.abs(actual - expected) < 0.5 * 10 ** -digits, `${actual} != ${expected}`);

test('mine: expected digs per floor follow the pity by last digit', () => {
    const mine = { ...RULES, floors: 200 };
    const digs = [1, 2, 3, 4, 5].map((floor) => expectedDigs(mine, floor).digs);
    [5.708, 6.495, 7.675, 5.708, 8.226].forEach((expected, i) => near(digs[i], expected));
    near(expectedDigs(mine, 16).digs, digs[0], 9);
    near(expectedDigs(mine, 20).normalDigs, digs[4] - 1, 9);
});

test('mine: segments end at the progress floors, normal loot shared over the tiles', () => {
    const mine = { ...RULES, floors: 200, progress_rewards: { 5: { gem: 1 }, 100: { gem: 2 } } };
    const segments = mineSegments(mine);
    assert.deepEqual(
        segments.map(({ from, to, reward }) => [from, to, reward]),
        [
            [1, 5, { gem: 1 }],
            [6, 100, { gem: 2 }],
            [101, 200, null],
        ],
    );
    near(segments[0].pickaxes, 33.813);
    near(segments[0].pickaxes + segments[1].pickaxes, 676.27);
    assert.deepEqual(normalRewardBundle({ ...mine, normal_rewards: [{ gem: 11 }, { gem: 22, ore: 1 }] }, 5.5), {
        gem: 16.5,
        ore: 0.5,
    });
});

test('mine: how safe the expected pickaxes are (the exact distribution of a run)', () => {
    const mine = { ...RULES, floors: 200 };
    // One floor ending in 1: at least 1 dig, at most pity 5 + 1.
    const one = pickaxeOdds(mine, 1, 1);
    near(one.mean, 5.708);
    assert.deepEqual([one.min, one.max], [1, 6]);
    assert.equal(one.chanceEnough(6), 1);
    assert.equal(one.chanceEnough(0), 0);
    // Floors 1-100: ≈ 676 on average, 9 in 10 runs within 695, never more than 780 (every floor at its pity).
    const run = pickaxeOdds(mine, 1, 100);
    near(run.mean, 676.27, 1);
    assert.deepEqual([run.atLeast(0.9), run.atLeast(0.99), run.max], [695, 710, 780]);
    assert.ok(Math.abs(run.chanceEnough(676) - 0.5) < 0.02, 'the mean is about the median');
});

test('mine: free pickaxes per day of the run, the purchase bonus with a pack every day', () => {
    const mine = { ...RULES, floors: 10, free_currency_per_day: 14, purchase_bonus_per_day: 6 };
    assert.deepEqual(freeCurrency(mine, { days: 3, withBonus: true }), {
        perDay: 14,
        bonusPerDay: 6,
        days: 3,
        total: 60,
    });
    assert.equal(freeCurrency(mine, { days: 3, withBonus: false }).total, 42);
    assert.equal(targetFloor({ floors: 200, progress_rewards: { 5: {}, 100: {}, 300: {} } }), 100);
    // Floors 1-5 take ≈ 33.8 pickaxes, floor 6 another ≈ 5.7.
    assert.equal(floorsFor(mine, 0, 39), 5);
    assert.equal(floorsFor(mine, 0, 40), 6);
    assert.equal(floorsFor(mine, 8, 1000), 2, 'never past the top floor');
    // From floor 3 on: the floors below are gone, and with them floor 3's progress reward.
    const segments = mineSegments({ ...mine, progress_rewards: { 3: { gem: 1 }, 5: { gem: 2 } } }, 3);
    assert.deepEqual(
        segments.map(({ from, to }) => [from, to]),
        [
            [4, 5],
            [6, 10],
        ],
    );
});

test('mine: the weekly plan digs a run only if it reaches the last progress reward', async () => {
    const highs = await loadHighs();
    const data = {
        items: { gem: {}, pick: {} },
        packages: {
            pick_pack: {
                price: 100,
                event_id: 'dig',
                contains: { pick: 10 },
                purchase_limit: 1,
                limit_type: 'daily',
            },
        },
        exchange_shops: {},
        mines: {
            dig_mine: {
                ...RULES,
                event_id: 'dig',
                currency_item_id: 'pick',
                floors: 12,
                free_currency_per_day: 2,
                purchase_bonus_per_day: 1,
                normal_rewards: [{ gem: 1 }],
                wish_rewards: [{ gem: 5 }, { gem: 20 }],
                progress_rewards: { 5: { gem: 1000 }, 10: { gem: 1000 } },
            },
        },
    };
    const plan = (budget, options = {}) =>
        solveWeeklyPlan(highs, data, {
            budget,
            activeEventIds: new Set(['dig']),
            basePoints: new Map([['gem', { value: 1, source: 'fit' }]]),
            ...options,
        }).mines[0];

    // A week: 7 packs (70) + 7 × (2 + 1 bonus) free = 91 pickaxes: floor 10 (≈ 67.6), not past it (the rest is saved).
    const week = plan(700);
    assert.equal(week.free.total, 21);
    assert.equal(week.digs, true);
    assert.equal(week.floorsCleared, 10);
    assert.deepEqual(week.progressReached, [5, 10]);
    assert.deepEqual(
        week.wishes.map((wish) => wish.count),
        [0, 10],
    );

    // 2 days left: 20 + 6 pickaxes, far from floor 10: not dug at all (they carry over).
    const short = plan(700, { eventDaysLeft: { dig: 2 } });
    assert.equal(short.free.total, 6);
    assert.equal(short.digs, false);
    assert.equal(short.floorsCleared, 0);
    // Without a pack a day (budget < 7 × 100) no purchase bonus.
    assert.equal(plan(600, { eventDaysLeft: { dig: 2 } }).free.bonusPerDay, 0);

    // Owned pickaxes from floor 6 on: floors 6-10 (≈ 33.8 pickaxes) reach the target, floor 5's reward is gone.
    const late = plan(0, { eventDaysLeft: { dig: 1 }, mineProgress: { dig_mine: { owned: 36, floor: 5 } } });
    assert.equal(late.digs, true);
    assert.equal(late.startFloor, 5);
    assert.equal(late.floorReached, 10);
    assert.deepEqual(late.progressReached, [10]);

    // Extra Banknotes for the event are only spent where they buy at least what a normal Banknote does (0.5
    // points from the gem pack): with plenty of pickaxes owned, the pick pack's single gem isn't worth 100.
    const withGems = {
        ...data,
        packages: {
            pick_pack: {
                ...data.packages.pick_pack,
                contains: { pick: 10, gem: 1 },
                purchase_limit: 3,
                limit_type: 'weekly',
            },
            gem_pack: { price: 100, contains: { gem: 50 }, purchase_limit: 5, limit_type: 'weekly' },
        },
    };
    const extra = (owned) =>
        solveWeeklyPlan(highs, withGems, {
            budget: 200,
            activeEventIds: new Set(['dig']),
            basePoints: new Map([['gem', { value: 1, source: 'fit' }]]),
            eventBudget: { eventId: 'dig', extra: 5000 },
            mineProgress: { dig_mine: { owned } },
        });
    const plenty = extra(200);
    assert.deepEqual(
        plenty.purchases.map((p) => p.id),
        ['gem_pack'],
    );
    assert.equal(plenty.eventExtraUsed, 0);
    assert.equal(plenty.mines[0].floorReached, 10);
    // 20 owned + 21 free need 3 pick packs for floor 10 (≈ 67.6): the budget pays 2, the extra the third.
    const few = extra(20);
    assert.deepEqual(
        few.purchases.map((p) => [p.id, p.count]),
        [['pick_pack', 3]],
    );
    assert.equal(few.eventExtraUsed, 100);
    assert.equal(few.mines[0].digs, true);

    // The safety planned with: 72 pickaxes reach floor 10 on average (≈ 67.6), but not in the worst case (78).
    const sure = (mineSafety) =>
        plan(0, { eventDaysLeft: { dig: 1 }, mineProgress: { dig_mine: { owned: 70 } }, mineSafety });
    assert.equal(sure(0.5).digs, true);
    assert.equal(sure(1).digs, false);
    near(
        sure(1).segments.reduce((sum, segment) => sum + segment.pickaxes, 0),
        78,
        9,
    );

    // Past the target nothing more is dug: the pickaxes are saved for the next run.
    const past = plan(0, { eventDaysLeft: { dig: 1 }, mineProgress: { dig_mine: { owned: 20, floor: 10 } } });
    assert.equal(past.digs, false);
    assert.equal(past.floorReached, 10);
});
