import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MAX_STARS,
    awakeningFrame,
    clampLevel,
    hasAwakenedPortrait,
    heroLevel,
    starIcons,
} from '../../webapp/src/core/hero-stars.js';

test('up to 5 stars that many yellow icons, from 6 stars the red ones replace them', () => {
    const Y = '5_5_ur';
    const R = '5_5_mr';
    const E = '0_5';
    assert.deepEqual(starIcons(0), [E, E, E, E, E]);
    assert.deepEqual(starIcons(3), [Y, Y, Y, E, E]);
    assert.deepEqual(starIcons(5), [Y, Y, Y, Y, Y]);
    assert.deepEqual(starIcons(6), [R, E, E, E, E], 'the yellow ones are gone');
    assert.deepEqual(starIcons(9), [R, R, R, R, E]);
    assert.deepEqual(starIcons(10), [R, R, R, R, R]);
});

test('levels are whole numbers from 0 to the maximum', () => {
    assert.equal(clampLevel(7), 7);
    assert.equal(clampLevel(-1), 0);
    assert.equal(clampLevel(11), MAX_STARS);
    assert.equal(clampLevel(3.8), 3);
    assert.equal(clampLevel(12, 5), 5);
    assert.equal(clampLevel(1000, Infinity), 1000);
    assert.equal(clampLevel('7'), 0, 'not a number');
    assert.equal(clampLevel(undefined), 0);
    assert.equal(clampLevel(NaN), 0);
});

test('the portrait frame is the highest of 1, 10, 20, 30, 40 the awakening level reaches, none below 1', () => {
    assert.equal(awakeningFrame(0), null);
    assert.equal(awakeningFrame(1), 1);
    assert.equal(awakeningFrame(9), 1);
    assert.equal(awakeningFrame(10), 10);
    assert.equal(awakeningFrame(29), 20);
    assert.equal(awakeningFrame(30), 30);
    assert.equal(awakeningFrame(40), 40);
    assert.equal(awakeningFrame(99), 40);
});

test('the awakened portrait is shown from awakening level 40', () => {
    assert.equal(hasAwakenedPortrait(39), false);
    assert.equal(hasAwakenedPortrait(40), true);
    assert.equal(hasAwakenedPortrait(0), false);
});

test("a hero's saved level: stars, weapon stars and awakening, 0 for what is missing or invalid", () => {
    const saved = {
        faction: 'warlock',
        heroes: {
            ulfrid: { stars: 7, weapon: 4, awakening: 30 },
            annie: { stars: 99, awakening: 12 },
            bad: 'x',
        },
    };
    assert.deepEqual(
        heroLevel(saved, 'ulfrid'),
        { stars: 7, weapon: 4, awakening: 0 },
        'only a hero with 10 stars can be awakened',
    );
    assert.deepEqual(heroLevel(saved, 'annie'), { stars: 10, weapon: 0, awakening: 12 });
    assert.deepEqual(heroLevel(saved, 'bad'), { stars: 0, weapon: 0, awakening: 0 });
    assert.deepEqual(heroLevel(saved, 'joker'), { stars: 0, weapon: 0, awakening: 0 });
    assert.deepEqual(heroLevel({}, 'ulfrid'), { stars: 0, weapon: 0, awakening: 0 });
    assert.deepEqual(heroLevel(null, 'ulfrid'), { stars: 0, weapon: 0, awakening: 0 });
});
