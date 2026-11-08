import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MR_STEP,
    starStep,
    starsOfStep,
    shownItem,
    mrItemIds,
    mergePaths,
    crossNeeds,
} from '../../webapp/src/core/gear-path.js';
import { loadFixture, expectGolden } from '../helpers.js';

const data = loadFixture();
const guide = data.squad_guides.default;
const gearSet = data.gear_upgrades[guide.gear];

test('stars <-> steps', () => {
    assert.equal(starStep(0), 0);
    assert.equal(starStep(2.6), 13);
    assert.equal(starStep(4), 20);
    assert.equal(starStep(5), 21);
    assert.equal(starStep(4.5), null);
    assert.equal(starStep(2.65), null);
    assert.equal(starsOfStep(13), 2.6);
    assert.equal(starsOfStep(21), 5);
});

test('a piece shows as its MR item at 5 stars only, and as itself without an MR item', () => {
    const set = { mr_items: { ur_sword: 'mr_sword' } };
    assert.equal(shownItem(set, 'ur_sword', MR_STEP), 'mr_sword');
    assert.equal(shownItem(set, 'ur_sword', MR_STEP - 1), 'ur_sword'); // 4.8 stars: still UR
    assert.equal(shownItem(set, 'ur_sword', 0), 'ur_sword');
    assert.equal(shownItem(set, 'ur_armor', MR_STEP), 'ur_armor'); // no entry for this piece
    assert.equal(shownItem({}, 'ur_sword', MR_STEP), 'ur_sword'); // a set without mr_items
});

test('the MR items of all gear sets are collected, and none without mr_items', () => {
    const sets = {
        a: { mr_items: { ur_sword: 'mr_sword', ur_armor: 'mr_armor' } },
        b: { mr_items: { x: 'mr_x' } },
        c: {},
    };
    assert.deepEqual([...mrItemIds(sets)].sort(), ['mr_armor', 'mr_sword', 'mr_x']);
    assert.equal(mrItemIds({}).size, 0);
    assert.equal(mrItemIds(undefined).size, 0);
});

test('merged order of the default guide', () => {
    const merged = mergePaths(guide, gearSet);
    assert.ok(
        merged.every((entry) => entry.problems.length === 0),
        'the default guide has no deadlock',
    );
    expectGolden('gear-merged', {
        order: merged.map((entry) => `${entry.path}:${entry.n}`),
        needs: crossNeeds(guide, gearSet),
    });
});

test('a level no star count unlocks is blocked for good, not "needs nothing"', () => {
    const tooHigh = { level: gearSet.max_level + 10, slots: 'all', items: 'all' };
    const needs = crossNeeds({ ...guide, level_path: [...guide.level_path, tooHigh] }, gearSet);
    assert.deepEqual(needs.level.at(-1), { path: 'stars', n: null, stars: 4 });
    // The steps of the real guide are unchanged.
    assert.deepEqual(needs.level.slice(0, -1), crossNeeds(guide, gearSet).level);
});

test('a level path the star path never unlocks is reported', () => {
    const merged = mergePaths({ ...guide, star_path: [] }, gearSet);
    const blocked = merged.filter((entry) => entry.problems.length > 0);
    assert.ok(blocked.length > 0);
    assert.ok(blocked.every((entry) => entry.path === 'level'));
    assert.ok(blocked.every((entry) => entry.problems.every((problem) => problem.code === 'levelCap')));
    assert.deepEqual(
        { ...blocked[0].problems[0], slot: undefined, item: undefined },
        { code: 'levelCap', slot: undefined, item: undefined, cap: gearSet.level_cap_by_stars[0], stars: 0 },
    );
});
