import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFixture } from '../helpers.js';
import {
    EPIGRAPH_ITEM_IDS,
    MAX_COUNT,
    PROMOTE_COPIES,
    chestDrops,
    chestEstimate,
    copiesNeeded,
    epigraphGaps,
    epigraphItemId,
    epigraphLevel,
    gapsCovered,
    nextPromotion,
    simulateChests,
    stockOf,
} from '../../webapp/src/core/epigraph-plan.js';

// The chests as the live data has them, small and inline: the numbers of these tests don't move when the data is edited.
const data = {
    items: {
        ur_epigraph_chest: { contains: { ur_epigraph: 1, ur_epigraph_shard: 100 } },
        ssr_epigraph_chest: {
            drop_table: [
                { contains: { ur_epigraph: 1, ur_epigraph_shard: 30 }, probability: 0.15 },
                { contains: { ssr_epigraph: 1, ur_epigraph_shard: 30 }, probability: 0.85 },
            ],
        },
        ur_epigraph_choice_chest: {
            choice: { select_count: 1, choices: [{ guard_of_nature_iv_warrior: 1, ur_epigraph_shard: 100 }] },
        },
        [EPIGRAPH_ITEM_IDS[0]]: { crafted_from: { ur_epigraph_shard: 800 } },
    },
};
const drops = chestDrops(data);

test('the 12 epigraphs are the four of each plan, and all of them are in the data', () => {
    assert.equal(epigraphItemId('guard_of_nature', 'warrior'), 'guard_of_nature_iv_warrior');
    assert.equal(EPIGRAPH_ITEM_IDS.length, 12);
    assert.equal(new Set(EPIGRAPH_ITEM_IDS).size, 12);
    const { items } = loadFixture();
    for (const id of EPIGRAPH_ITEM_IDS) {
        assert.ok(items[id], id);
    }
});

test('promoting an epigraph from 0 to the highest level takes 28 copies, the copies on hand count against it', () => {
    assert.deepEqual(PROMOTE_COPIES, [1, 2, 3, 5, 7, 10]);
    assert.equal(copiesNeeded(0, 0), 28);
    assert.equal(copiesNeeded(5, 2), 8);
    assert.equal(copiesNeeded(2, 6), 19, 'the next promotions: 3 + 5 + 7 + 10 = 25, less 6 on hand');
    assert.equal(copiesNeeded(6, 0), 0);
    assert.equal(copiesNeeded(5, 40), 0, 'never below 0');
    assert.equal(nextPromotion(0), 1);
    assert.equal(nextPromotion(5), 10);
    assert.equal(nextPromotion(6), null, 'a maxed epigraph has no next promotion');
});

test('the saved state is clamped, and what is not saved is 0', () => {
    assert.deepEqual(epigraphLevel({}, 'guard_of_nature_iv_warrior'), { level: 0, copies: 0 });
    const saved = {
        epigraphs: {
            a: { level: 9, copies: -3 },
            b: { level: 2.7, copies: 4.9 },
            c: { level: 'x', copies: Infinity },
            d: { level: 4, copies: 1e12 },
        },
        shards: -5,
        choiceChests: 'x',
    };
    assert.deepEqual(epigraphLevel(saved, 'a'), { level: 6, copies: 0 });
    assert.deepEqual(epigraphLevel(saved, 'b'), { level: 2, copies: 4 });
    assert.deepEqual(epigraphLevel(saved, 'c'), { level: 0, copies: 0 });
    assert.equal(epigraphLevel(saved, 'd').copies, MAX_COUNT);
    assert.equal(stockOf(saved, 'shards'), 0);
    assert.equal(stockOf(saved, 'choiceChests'), 0);
    assert.equal(stockOf({ shards: 1250 }, 'shards'), 1250);
});

test('the gaps of all 12 epigraphs: 28 copies each from nothing', () => {
    assert.deepEqual(epigraphGaps({}), Array(12).fill(28));
    const saved = {
        epigraphs: { guard_of_nature_iv_ranger: { level: 6 }, frenzied_flock_iv_warrior: { level: 5, copies: 4 } },
    };
    const gaps = epigraphGaps(saved);
    assert.equal(gaps[EPIGRAPH_ITEM_IDS.indexOf('guard_of_nature_iv_ranger')], 0);
    assert.equal(gaps[EPIGRAPH_ITEM_IDS.indexOf('frenzied_flock_iv_warrior')], 6);
    assert.equal(gaps[EPIGRAPH_ITEM_IDS.indexOf('reversal_power_iv_warlock')], 28);
});

test('what the chests give is read from the data', () => {
    assert.deepEqual(drops.chests.ur, { urChance: 1, shards: 100 });
    assert.equal(drops.chests.ssr.urChance, 0.15);
    assert.equal(drops.chests.ssr.shards, 30);
    assert.equal(drops.choiceShards, 100);
    assert.equal(drops.craftShards, 800);
    const none = chestDrops({ items: {} });
    assert.deepEqual(none.chests.ur, { urChance: 0, shards: 0 });
    assert.equal(none.craftShards, Infinity);
});

test('the choice chests fill gaps first, each with its shards, then 800 shards craft one', () => {
    assert.ok(gapsCovered(0, 0, 0, drops), 'nothing missing');
    assert.ok(!gapsCovered(3, 2, 0, drops));
    assert.ok(gapsCovered(3, 3, 0, drops));
    assert.ok(gapsCovered(3, 5, 0, drops), 'more choice chests than gaps');
    assert.ok(gapsCovered(3, 0, 2400, drops), 'three crafts');
    assert.ok(!gapsCovered(3, 0, 2399, drops));
    assert.ok(gapsCovered(3, 2, 600, drops), '2 chests give 200 shards, with 600 that is one more craft');
    assert.ok(!gapsCovered(3, 2, 599, drops));
});

test('with enough on hand no chest is needed, and a chest that gives nothing has no answer', () => {
    const gaps = [1, 2, 0, 0];
    assert.deepEqual(simulateChests(gaps, 'ur', { choiceChests: 3, shards: 0 }, drops), { expected: 0, safe: 0 });
    assert.equal(simulateChests(gaps, 'ur', { choiceChests: 0, shards: 0 }, chestDrops({ items: {} })), null);
});

test('chests that only give shards take exactly as many as the missing crafts', () => {
    const shardsOnly = { ...drops, chests: { ur: { urChance: 0, shards: 100 } } };
    const result = simulateChests([2, 0], 'ur', { choiceChests: 0, shards: 0 }, shardsOnly, { runs: 50 });
    assert.deepEqual(result, { expected: 16, safe: 16 }, '1600 shards at 100 a chest');
});

test('the same seed gives the same answer, another seed a close one', () => {
    const gaps = [10, 10, 5];
    const stock = { choiceChests: 0, shards: 0 };
    const a = simulateChests(gaps, 'ur', stock, drops, { seed: 7 });
    assert.deepEqual(simulateChests(gaps, 'ur', stock, drops, { seed: 7 }), a);
    const b = simulateChests(gaps, 'ur', stock, drops, { seed: 8 });
    assert.ok(Math.abs(a.expected - b.expected) <= 2);
    assert.ok(a.safe >= a.expected - 1, 'nine runs in ten are not below the mean');
});

test('a UR chest gives at best a copy and an eighth of a craft, so 12 epigraphs from nothing take about 300 chests or more', () => {
    const result = chestEstimate(data, {});
    assert.equal(result.missing, 336);
    assert.equal(result.covered, 0);
    assert.ok(result.ur.expected >= 299, `${result.ur.expected}`);
    assert.ok(result.ur.expected < 600, `${result.ur.expected}`);
    assert.ok(result.ur.safe >= result.ur.expected);
});

test('a SSR chest is a copy 15 % of the time, so it takes many times as many as a UR chest', () => {
    const result = chestEstimate(data, {});
    assert.ok(result.ssr.expected > result.ur.expected * 4);
    assert.ok(result.ssr.safe >= result.ssr.expected);
});

test('choice chests and shards on hand lower the answer and are counted as covered', () => {
    const none = chestEstimate(data, {});
    const some = chestEstimate(data, { choiceChests: 4, shards: 1700 });
    assert.equal(some.covered, 4 + 2 + 0, '4 chests give 400 more shards: 2100 shards craft 2');
    assert.ok(some.ur.expected < none.ur.expected);
});

test('everything maxed needs nothing', () => {
    const epigraphs = Object.fromEntries(EPIGRAPH_ITEM_IDS.map((id) => [id, { level: 6 }]));
    assert.deepEqual(chestEstimate(data, { epigraphs }), {
        missing: 0,
        covered: 0,
        ur: { expected: 0, safe: 0 },
        ssr: { expected: 0, safe: 0 },
    });
});
