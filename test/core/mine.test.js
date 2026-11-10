import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    targetFloor,
    freeCurrency,
    expectedDigs,
    pickaxeOdds,
    floorsFor,
    mineEconomics,
    mineProgressFor,
    mineSegments,
    normalRewardBundle,
    pityGroups,
} from '../../webapp/src/core/mine.js';
import { solveWeeklyPlan } from '../../webapp/src/core/planner.js';
import { loadHighs } from '../../webapp/src/core/lp.js';
import { near } from '../helpers.js';

// The Dwarven Mine's rules: 12 tiles (1 wish), normal weight 10, the wish's weight rising with the digs done.
const RULES = {
    tiles_per_floor: 12,
    normal_weight: 10,
    special_weights: { 0: 1, 3: 5, 6: 10, 9: 30 },
    pity: { 0: 10, 1: 5, 2: 6, 3: 8, 4: 5, 5: 10, 6: 5, 7: 6, 8: 8, 9: 5 },
};

test('mine: expected digs per floor follow the pity by last digit', () => {
    const mine = { ...RULES, floors: 200 };
    const digs = [1, 2, 3, 4, 5].map((floor) => expectedDigs(mine, floor).digs);
    [5.708, 6.495, 7.675, 5.708, 8.226].forEach((expected, i) => near(digs[i], expected));
    near(expectedDigs(mine, 16).digs, digs[0], { digits: 9 });
    near(expectedDigs(mine, 20).normalDigs, digs[4] - 1, { digits: 9 });
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
    near(run.mean, 676.27, { digits: 1 });
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

// A dig event with a 12-floor mine, 10 pickaxes a day from a pack and 2 free (+1 with a pack bought that day);
// floors 5 and 10 give the progress rewards.
const highs = await loadHighs();
const dig = {
    items: { gem: {}, pick: {} },
    packages: {
        pick_pack: { price: 100, event_id: 'dig', contains: { pick: 10 }, purchase_limit: 1, limit_type: 'daily' },
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
const GEM_POINTS = new Map([['gem', { value: 1, source: 'fit' }]]);
const planMine = (budget, options = {}, data = dig) =>
    solveWeeklyPlan(highs, data, {
        budget,
        activeEventIds: new Set(['dig']),
        basePoints: GEM_POINTS,
        ...options,
    });
const mineOf = (budget, options) => planMine(budget, options).mines[0];

test('mine: a week of packs and free pickaxes digs to the last progress reward and saves the rest', () => {
    // 7 packs (70) + 7 × (2 + 1 bonus) free = 91 pickaxes: floor 10 (≈ 67.6), not past it.
    const week = mineOf(700);
    assert.equal(week.free.total, 21);
    assert.equal(week.digs, true);
    assert.equal(week.floorsCleared, 10);
    assert.deepEqual(week.progressReached, [5, 10]);
    assert.deepEqual(
        week.wishes.map((wish) => wish.count),
        [0, 10],
    );
});

test('mine: with 2 days left the pickaxes are too few to dig and carry over', () => {
    // 20 + 6 pickaxes, far from floor 10.
    const short = mineOf(700, { eventDaysLeft: { dig: 2 } });
    assert.equal(short.free.total, 6);
    assert.equal(short.digs, false);
    assert.equal(short.floorsCleared, 0);
});

test('mine: the purchase bonus needs a pack a day', () => {
    assert.equal(mineOf(600, { eventDaysLeft: { dig: 2 } }).free.bonusPerDay, 0, 'budget < 7 × 100');
});

test('mine: owned pickaxes and the floor reached count, and a passed floor gives no reward again', () => {
    // From floor 6 on: floors 6-10 (≈ 33.8 pickaxes) reach the target; floor 5's reward is gone.
    const late = mineOf(0, { eventDaysLeft: { dig: 1 }, mineProgress: { dig_mine: { owned: 36, floor: 5 } } });
    assert.equal(late.digs, true);
    assert.equal(late.startFloor, 5);
    assert.equal(late.floorReached, 10);
    assert.deepEqual(late.progressReached, [10]);
});

test('mine: past the target nothing more is dug, the pickaxes are saved for the next run', () => {
    const past = mineOf(0, { eventDaysLeft: { dig: 1 }, mineProgress: { dig_mine: { owned: 20, floor: 10 } } });
    assert.equal(past.digs, false);
    assert.equal(past.floorReached, 10);
});

test('mine: the safety planned with decides whether the pickaxes reach the target', () => {
    // 72 pickaxes reach floor 10 on average (≈ 67.6), but not in the worst case (78).
    const sure = (mineSafety) =>
        mineOf(0, { eventDaysLeft: { dig: 1 }, mineProgress: { dig_mine: { owned: 70 } }, mineSafety });
    assert.equal(sure(0.5).digs, true);
    assert.equal(sure(1).digs, false);
    near(
        sure(1).segments.reduce((sum, segment) => sum + segment.pickaxes, 0),
        78,
        { digits: 9 },
    );
});

// Extra Banknotes for the event pay for its packs first, and the budget keeps its spend on the other deals: the pick
// pack also gives a gem, and a gem pack competes for the budget.
const withGems = {
    ...dig,
    packages: {
        pick_pack: {
            ...dig.packages.pick_pack,
            contains: { pick: 10, gem: 1 },
            purchase_limit: 3,
            limit_type: 'weekly',
        },
        gem_pack: { price: 100, contains: { gem: 50 }, purchase_limit: 5, limit_type: 'weekly' },
    },
};
const withExtra = (owned) =>
    planMine(200, { extraEventBanknotes: { dig: 5000 }, mineProgress: { dig_mine: { owned } } }, withGems);
const bought = (plan) => Object.fromEntries(plan.purchases.map((p) => [p.id, p.count]));

test('mine: extra event Banknotes buy the pick packs even when plenty of pickaxes are owned', () => {
    // Free money for the event: the 3 pick packs (a gem each) it can take; the budget stays on the gem packs.
    const plenty = withExtra(200);
    assert.deepEqual(bought(plenty), { pick_pack: 3, gem_pack: 2 });
    assert.deepEqual(plenty.eventExtraUsed, { dig: 300 });
    assert.equal(plenty.regularSpent, 200);
    assert.equal(plenty.mines[0].floorReached, 10);
});

test('mine: extra event Banknotes pay for the pick packs the pickaxes need, not the budget', () => {
    // 20 owned + 21 free need 3 pick packs for floor 10 (≈ 67.6): the extra pays all three.
    const few = withExtra(20);
    assert.deepEqual(bought(few), { pick_pack: 3, gem_pack: 2 });
    assert.deepEqual(few.eventExtraUsed, { dig: 300 });
    assert.equal(few.mines[0].digs, true);
});

test('mine: the floor reached only counts for the run it was entered for', () => {
    const stored = { pickaxes: 12, floor: 40, run: 100 };
    assert.deepEqual(mineProgressFor(stored, { start: 100 }), { owned: 12, floor: 40 });
    assert.deepEqual(mineProgressFor(stored, { start: 107 }), { owned: 12, floor: 0 }, 'a later run starts over');
    assert.deepEqual(mineProgressFor(stored, null), { owned: 12, floor: 0 });
    assert.deepEqual(mineProgressFor(undefined, { start: 100 }), { owned: 0, floor: 0 });
});

test('mine: last digits with the same pity are listed together', () => {
    const groups = pityGroups({ ...RULES, floors: 200 });
    assert.deepEqual(
        groups.map(({ pity, digits }) => [pity, digits]),
        [
            [5, [1, 4, 6, 9]],
            [6, [2, 7]],
            [8, [3, 8]],
            [10, [5, 0]],
        ],
    );
    near(groups[0].averageDigs, 5.708);
    near(groups[3].averageDigs, 8.226, { digits: 3 });
    // A last digit without a pity needs every normal tile first.
    assert.deepEqual(
        pityGroups({ ...RULES, floors: 200, pity: {} }).map(({ pity }) => pity),
        [11],
    );
});

test('mine: what the floors cost and give, with the pickaxes bought from the packs', () => {
    const mine = {
        ...RULES,
        floors: 10,
        progress_rewards: { 5: { gem: 1 } },
        normal_rewards: [{ gem: 11 }],
        wish_rewards: [{ wish: 1 }, { wish: 3 }],
    };
    const segments = mineSegments(mine).filter((segment) => segment.to <= 5);
    const dug = { mine, owned: 0, free: { total: 0 }, startFloor: 0, target: 5, segments };
    // Every item is worth 2 Banknotes, a pickaxe 3 (when no pack sells them); the packs sell them at 4 each.
    const bundleWorth = (contents) => 2 * Object.values(contents).reduce((sum, qty) => sum + qty, 0);
    const pricing = {
        pickaxeWorth: 3,
        bundleWorth,
        coin: { received: 10, extra: 0, spent: 4 },
        packCost: (bought) => ({ banknotes: 4 * bought, available: 50 }),
    };
    const economics = mineEconomics(dug, pricing);
    // The stretch to the progress reward, then the floors above the target (never dug).
    assert.deepEqual(
        economics.rows.map(({ segment }) => [segment.from, segment.to, Boolean(segment.aboveTarget)]),
        [
            [1, 5, false],
            [6, 10, true],
        ],
    );
    const first = economics.rows[0];
    const loot = bundleWorth(normalRewardBundle(mine, first.segment.normalDigs));
    near(first.worth, loot + 5 * 6 + 2, { digits: 6 }); // loot + 5 wishes at the best (3 x 2) + the progress reward (1 x 2)
    near(first.cost, 4 * first.segment.pickaxes, { digits: 6 });
    near(first.ratio, first.worth / first.cost, { digits: 9 });
    assert.deepEqual(economics.wishWorths, [2, 6]);
    assert.equal(economics.have, 10);
    assert.equal(economics.fromPacks, 10);
    assert.equal(economics.spent, 4);
    assert.equal(economics.available, 50);
    near(economics.needed, first.segment.pickaxes, { digits: 9 });
    near(economics.costToTarget, 4 * (economics.needed - 10), { digits: 6 });
    assert.ok(economics.odds.mean > 0);
});
