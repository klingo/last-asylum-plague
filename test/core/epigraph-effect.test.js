import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    clampEvolve,
    describeEpigraph,
    effectEntry,
    evolveBoost,
    evolveLevelOf,
    planUnlocked,
} from '../../webapp/src/core/epigraph-effect.js';

const raven = {
    evolve_boost_levels: [150, 300, 450, 600, 750],
    evolve_max_level: 900,
    plan_unlock_levels: { warrior: 10, ranger: 150, warlock: 300 },
    epigraphs: {
        guard_of_nature: {
            warrior: {
                description: {
                    en: 'Gain a {shield}+{bonus_shield}-HP shield, damage down {reduction}%+{bonus_reduction}%.',
                    de: '',
                },
                values: {
                    shield: [null, 1000000, 1600000, 2000000, 2400000, 3200000, 4000000],
                    reduction: [0, 5, 7.5, 10, 12.5, 15, 17.5],
                },
                bonus_values: {
                    bonus_shield: [0, 100000, 200000, 300000, 400000, 500000],
                    bonus_reduction: [0, 1, 2, 3, null, 5],
                },
            },
        },
    },
};

test('the Raven Evolve level is a whole number from 0 to the highest', () => {
    assert.equal(clampEvolve(raven, 300), 300);
    assert.equal(clampEvolve(raven, 0), 0);
    assert.equal(clampEvolve(raven, -5), 0);
    assert.equal(clampEvolve(raven, 1200), 900);
    assert.equal(clampEvolve(raven, 12.9), 12);
    assert.equal(clampEvolve(raven, 'x'), 0, 'not a number: 0');
    assert.equal(evolveLevelOf(raven, { evolveLevel: 450 }), 450);
    assert.equal(evolveLevelOf(raven, {}), 0, 'not saved: 0, no plan unlocked');
    assert.equal(evolveLevelOf(raven, undefined), 0);
});

test('the boost is how many of the boost levels the Raven Evolve level has reached', () => {
    assert.equal(evolveBoost(raven, 1), 0);
    assert.equal(evolveBoost(raven, 149), 0);
    assert.equal(evolveBoost(raven, 150), 1);
    assert.equal(evolveBoost(raven, 449), 2);
    assert.equal(evolveBoost(raven, 450), 3);
    assert.equal(evolveBoost(raven, 750), 5);
    assert.equal(evolveBoost(raven, 900), 5);
});

test('an epigraph without an entry has no text yet', () => {
    assert.equal(effectEntry(raven, 'guard_of_nature', 'ranger'), null);
    assert.equal(effectEntry(raven, 'frenzied_flock', 'warrior'), null);
    assert.equal(effectEntry({ epigraphs: undefined }, 'guard_of_nature', 'warrior'), null);
    assert.ok(effectEntry(raven, 'guard_of_nature', 'warrior'));
});

test('a number has the bonus of the boost behind it, and the bonus belongs to the number', () => {
    const entry = effectEntry(raven, 'guard_of_nature', 'warrior');
    const text = entry.description.en;
    assert.deepEqual(describeEpigraph(entry, text, 5, 2), [
        'Gain a ',
        { sign: '', now: 3200000, unit: '', bonus: { now: 200000, unit: '' } },
        '-HP shield, damage down ',
        { sign: '', now: 15, unit: '%', bonus: { now: 2, unit: '%' } },
        '.',
    ]);
    assert.deepEqual(
        describeEpigraph(entry, 'Absorbs {reduction}% damage, +{shield} more.', 1, 0),
        [
            'Absorbs ',
            { sign: '', now: 5, unit: '%', bonus: null },
            ' damage, ',
            { sign: '+', now: 1000000, unit: '', bonus: null },
            ' more.',
        ],
        'a number without a bonus behind it; a plus that has no number before it is a number of its own',
    );
});

test('level 0 is the first entry of a list, the highest level the last, what is not known is null', () => {
    const entry = effectEntry(raven, 'guard_of_nature', 'warrior');
    const text = entry.description.en;
    const at = (level, boost, index) => describeEpigraph(entry, text, level, boost)[index];
    assert.deepEqual(
        at(0, 0, 1),
        { sign: '', now: null, unit: '', bonus: { now: 0, unit: '' } },
        'level 0 of the shield is not known; no boost: a bonus of 0, which the page leaves out',
    );
    assert.deepEqual(
        at(6, 5, 1),
        { sign: '', now: 4000000, unit: '', bonus: { now: 500000, unit: '' } },
        'no level above 6',
    );
    assert.deepEqual(at(6, 5, 3), { sign: '', now: 17.5, unit: '%', bonus: { now: 5, unit: '%' } });
    assert.deepEqual(at(1, 4, 3).bonus, { now: null, unit: '%' }, 'the bonus of boost 4 is not known');
    assert.equal(at(1, 9, 1).bonus.now, null, 'a boost beyond the list is not known');
});

test('a plan is unlocked from its Raven Evolve level, a plan the data has no level for always is', () => {
    assert.equal(planUnlocked(raven, 'warrior', 9), false);
    assert.equal(planUnlocked(raven, 'warrior', 10), true);
    assert.equal(planUnlocked(raven, 'ranger', 149), false);
    assert.equal(planUnlocked(raven, 'ranger', 150), true);
    assert.equal(planUnlocked(raven, 'warlock', 299), false);
    assert.equal(planUnlocked(raven, 'warlock', 300), true);
    assert.equal(planUnlocked({ evolve_max_level: 900 }, 'warlock', 1), true);
});
