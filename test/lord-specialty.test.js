import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    changeTalent,
    decodeBuild,
    emptyBuild,
    encodeBuild,
    isLocked,
    isOutOfSeason,
    isReachable,
    pointsLeft,
    raiseBlock,
    requirements,
    spentPoints,
    talentRows,
    talentValue,
} from '../webapp/src/core/lord-specialty.js';

const talent = (id, unlockLevel, maxLevel, values) => ({ id, unlock_level: unlockLevel, max_level: maxLevel, values });
const lord = {
    talents: [
        talent('a', 1, 5, [3, 6, 10, 16, 24]),
        talent('b', 1, 1),
        talent('c', 5, 3, [10, 20, 30]),
        talent('d', 5, 2, [10, 20]),
        talent('e', 45, 5),
    ],
};
const MAX_LEVEL = 10;

test('points spent', () => {
    assert.equal(spentPoints([5, 1, 0, 2, 0]), 8);
    assert.deepEqual(emptyBuild(lord), [0, 0, 0, 0, 0]);
});

test('a build needs the highest unlock level of its talents and a level per point', () => {
    const needs = (build) => requirements(lord, build, MAX_LEVEL);
    assert.deepEqual(needs([0, 0, 0, 0, 0]), { spent: 0, unlockLevel: 0, level: 0, extra: 0 });
    // Unlock level above the points: the level unlocks the talent.
    assert.deepEqual(needs([0, 0, 1, 0, 0]), { spent: 1, unlockLevel: 5, level: 5, extra: 0 });
    // More points than the unlock level: one level per point.
    assert.deepEqual(needs([5, 1, 1, 0, 0]), { spent: 7, unlockLevel: 5, level: 7, extra: 0 });
    // More points than the season's levels: extra points for the rest.
    assert.deepEqual(needs([5, 1, 3, 2, 0]), { spent: 11, unlockLevel: 5, level: 10, extra: 1 });
});

test('the points left and whether the player can have the build', () => {
    assert.equal(pointsLeft([5, 1, 0, 0, 0], { level: 8, extra: 2 }), 4);
    assert.equal(pointsLeft([5, 1, 0, 0, 0], { level: 4, extra: 0 }), -2);
    assert.equal(isReachable(lord, [5, 1, 0, 0, 0], { level: 6, extra: 0 }), true);
    // Enough points, but the level doesn't unlock talent c.
    assert.equal(isReachable(lord, [0, 0, 1, 0, 0], { level: 4, extra: 5 }), false);
    // The level unlocks everything, extra points pay for the rest.
    assert.equal(isReachable(lord, [5, 1, 1, 0, 0], { level: 5, extra: 2 }), true);
    assert.equal(isReachable(lord, [5, 1, 1, 0, 0], { level: 5, extra: 1 }), false);
});

test('a talent takes points up to its max level, but not out of season', () => {
    assert.equal(raiseBlock(lord, [0, 0, 0, 0, 0], 2, MAX_LEVEL, MAX_LEVEL), null);
    assert.equal(raiseBlock(lord, [0, 1, 0, 0, 0], 1, MAX_LEVEL, MAX_LEVEL), 'maxed');
    assert.equal(raiseBlock(lord, [0, 0, 0, 0, 0], 4, MAX_LEVEL, MAX_LEVEL), 'outOfSeason');
    // The player's level doesn't unlock talent c (Lv.5) yet.
    assert.equal(raiseBlock(lord, [0, 0, 0, 0, 0], 2, 4, MAX_LEVEL), 'locked');
    assert.equal(isLocked(lord.talents[2], 4, MAX_LEVEL), true);
    assert.equal(isLocked(lord.talents[2], 5, MAX_LEVEL), false);
    assert.equal(isLocked(lord.talents[4], 50, MAX_LEVEL), true);
    assert.equal(isOutOfSeason(lord.talents[4], MAX_LEVEL), true);
    assert.equal(isOutOfSeason(lord.talents[2], MAX_LEVEL), false);
});

test('changing a talent stays within 0 and its max level', () => {
    assert.deepEqual(changeTalent(lord, [0, 0, 0, 0, 0], 0, 1), [1, 0, 0, 0, 0]);
    assert.deepEqual(changeTalent(lord, [0, 0, 0, 0, 0], 0, -1), [0, 0, 0, 0, 0]);
    assert.deepEqual(changeTalent(lord, [0, 1, 0, 0, 0], 1, 1), [0, 1, 0, 0, 0]);
});

test('the value at a talent level', () => {
    assert.equal(talentValue(lord.talents[0], 3), 10);
    assert.equal(talentValue(lord.talents[0], 0), null);
    assert.equal(talentValue(lord.talents[1], 1), null);
});

test('the build as URL text and back', () => {
    const build = [5, 1, 0, 2, 0];
    assert.equal(encodeBuild(build), '5102');
    assert.equal(encodeBuild(emptyBuild(lord)), '');
    assert.deepEqual(decodeBuild(lord, '5102', MAX_LEVEL), build);
    assert.deepEqual(decodeBuild(lord, '', MAX_LEVEL), [0, 0, 0, 0, 0]);
    assert.deepEqual(decodeBuild(lord, null, MAX_LEVEL), [0, 0, 0, 0, 0]);
    // Too high for the talent: capped; not a digit: 0; out of season: 0; extra digits: ignored.
    assert.deepEqual(decodeBuild(lord, '9x99999', MAX_LEVEL), [5, 0, 3, 2, 0]);
});

test('the tree rows by unlock level', () => {
    assert.deepEqual(
        talentRows(lord).map(({ level, talents }) => [level, talents.map(({ index }) => index)]),
        [
            [1, [0, 1]],
            [5, [2, 3]],
            [45, [4]],
        ],
    );
});
