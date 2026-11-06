import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyStep,
    initialState,
    mergePaths,
    starIcons,
    stepCost,
    stepItems,
    stepSlots,
} from '../../webapp/src/core/gear-path.js';

// Two slots, two pieces. Levels are capped by whole stars (0 stars: Lv 10, 1: Lv 20, up to Lv 30), and working toward
// the 1st star needs Lv 5, the 2nd Lv 15.
const gearSet = {
    items: ['sword', 'boots'],
    max_level: 30,
    level_cap_by_stars: { 0: 10, 1: 20, 2: 30, 3: 30, 4: 30 },
    min_level_for_star: { 1: 5, 2: 15 },
    level_costs: { 1: { ore: 10 }, 2: { ore: 10 }, 3: { ore: 10 }, 4: { ore: 10 }, 5: { ore: 10 }, 6: { ore: 10 } },
    star_costs: { 0.2: { gem: 1 }, 0.4: { gem: 1 }, 0.6: { gem: 1 }, 0.8: { gem: 1 }, 1: { gem: 2 } },
};
const guide = { slots: { a: {}, b: {} } };
const craftAll = [
    { item: 'sword', slot: 'a' },
    { item: 'sword', slot: 'b' },
    { item: 'boots', slot: 'a' },
    { item: 'boots', slot: 'b' },
];
const crafted = () =>
    craftAll.reduce((state, step) => applyStep(state, step, guide, gearSet), initialState(guide, gearSet));
const problemCodes = (guideWith) =>
    mergePaths(guideWith, gearSet).flatMap((entry) => entry.problems.map((p) => p.code));

test('stars are drawn as five icons, filled in fifths, all full at MR', () => {
    assert.deepEqual(starIcons(0), ['0_5', '0_5', '0_5', '0_5', '0_5']);
    assert.deepEqual(starIcons(13), ['5_5_ur', '5_5_ur', '3_5_ur', '0_5', '0_5']);
    assert.deepEqual(starIcons(21), Array(5).fill('5_5_ur'));
});

test('a step names its slots and pieces, "all" meaning the whole squad or gear set', () => {
    assert.deepEqual(stepSlots(guide, { slot: 'a', item: 'sword' }), ['a']);
    assert.deepEqual(stepSlots(guide, { slots: 'all', level: 5, items: 'all' }), ['a', 'b']);
    assert.deepEqual(stepSlots(guide, { slots: ['b'], level: 5, items: 'all' }), ['b']);
    assert.deepEqual(stepItems(gearSet, { items: 'all', level: 5 }), ['sword', 'boots']);
    assert.deepEqual(stepItems(gearSet, { item: 'sword', slot: 'a' }), ['sword']);
});

test('applying a step crafts, levels and stars the pieces without touching the state before', () => {
    const start = initialState(guide, gearSet);
    const after = applyStep(start, { item: 'sword', slot: 'a' }, guide, gearSet);
    assert.equal(start.a.sword.crafted, false, 'the state before is unchanged');
    assert.equal(after.a.sword.crafted, true);
    const leveled = applyStep(crafted(), { slots: 'all', items: 'all', level: 8 }, guide, gearSet);
    assert.equal(leveled.b.boots.level, 8);
    const starred = applyStep(leveled, { slots: ['a'], items: ['sword'], stars: 0.6 }, guide, gearSet);
    assert.equal(starred.a.sword.starStep, 3);
    assert.equal(
        applyStep(starred, { slots: ['a'], items: ['sword'], level: 4 }, guide, gearSet).a.sword.level,
        8,
        'a step is a minimum',
    );
});

test('a step costs what its pieces need from where they are to its target', () => {
    const state = applyStep(crafted(), { slots: 'all', items: 'all', level: 2 }, guide, gearSet);
    // Two pieces from Lv 2 to Lv 5: three levels each.
    assert.deepEqual(stepCost(state, { slots: 'all', items: ['sword'], level: 5 }, guide, gearSet), { ore: 60 });
    // Stars 0 -> 1 on one piece: four fifths of 1 gem and the last of 2.
    assert.deepEqual(stepCost(state, { slots: ['a'], items: ['sword'], stars: 1 }, guide, gearSet), { gem: 6 });
    assert.equal(stepCost(state, { item: 'sword', slot: 'a' }, guide, gearSet), null, 'crafting has no table');
    assert.equal(
        stepCost(state, { slots: 'all', items: 'all', level: 9 }, guide, gearSet),
        null,
        'a level without a cost entry',
    );
});

test('a path that cannot work reports why', () => {
    const order = (level_path, star_path = [], craft_path = craftAll) => ({
        ...guide,
        craft_path,
        level_path,
        star_path,
    });
    assert.deepEqual(
        problemCodes(order([{ slots: 'all', items: 'all', level: 5 }], [], [])),
        Array(4).fill('notCrafted'),
    );
    assert.ok(
        problemCodes(order([{ slots: 'all', items: 'all', level: 40 }])).includes('aboveMax'),
        'above the gear set max level',
    );
    assert.ok(
        problemCodes(order([{ slots: 'all', items: 'all', level: 15 }])).includes('levelCap'),
        'Lv 15 needs a star first',
    );
    assert.ok(problemCodes(order([], [{ slots: 'all', items: 'all', stars: 1 }])).includes('starNeedsLevel'));
    assert.ok(problemCodes(order([], [{ slots: 'all', items: 'all', stars: 0.3 }])).includes('invalidStars'));
    assert.ok(problemCodes(order([{ slots: ['nobody'], items: 'all', level: 5 }])).includes('unknownSlot'));
    assert.ok(problemCodes(order([{ slots: 'all', items: ['spoon'], level: 5 }])).includes('unknownItem'));
    assert.ok(problemCodes(order([], [], [...craftAll, craftAll[0]])).includes('alreadyCrafted'));
    assert.ok(
        problemCodes(
            order([
                { slots: 'all', items: 'all', level: 5 },
                { slots: 'all', items: 'all', level: 5 },
            ]),
        ).includes('noEffect'),
    );
});

test('a path that can work is merged with the steps one needs before the other', () => {
    const merged = mergePaths(
        {
            ...guide,
            craft_path: craftAll,
            level_path: [
                { slots: 'all', items: 'all', level: 8 },
                { slots: 'all', items: 'all', level: 18 },
            ],
            star_path: [{ slots: 'all', items: 'all', stars: 1 }],
        },
        gearSet,
    );
    assert.ok(merged.every((entry) => entry.problems.length === 0));
    const order = merged.map((entry) => `${entry.path}:${entry.n}`);
    assert.ok(order.indexOf('level:0') < order.indexOf('stars:0'), 'Lv 8 before the star that needs Lv 5+');
    assert.ok(order.indexOf('stars:0') < order.indexOf('level:1'), 'Lv 18 only after the 1st star lifts the cap');
});
