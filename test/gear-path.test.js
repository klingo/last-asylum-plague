import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starStep, starsOfStep, mergePaths, crossNeeds } from '../webapp/src/lib/gear-path.js';
import { loadFixture, expectGolden } from './helpers.js';

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
