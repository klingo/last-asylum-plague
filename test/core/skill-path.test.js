import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    START_LEVEL,
    describeSkill,
    foundationLevel,
    nextChange,
    skillCap,
    skillLevels,
    skillSteps,
    starredSkill,
} from '../../webapp/src/core/skill-path.js';

const heroes = { a: { class: 'carry' }, b: { class: 'tank' }, c: { class: 'support' } };
const skillData = {
    max_level: 30,
    foundation: { carry: 15, tank: 10, support: 10 },
    awakening_caps: [
        { level: 3, cap: 31 },
        { level: 7, cap: 32 },
        { level: 40, cap: 40 },
    ],
    order: { warrior: ['a', 'b'], ranger: ['c'] },
    foundation_order: { warrior: ['a', 'b'], ranger: ['c'] },
    heroes: {
        a: {
            path: [
                { skills: ['ultimate', 'active'], level: 20 },
                { skills: ['auto_attack'], level: 30 },
            ],
        },
        b: { path: [{ skills: ['active'], level: 30 }] },
        c: { path: [{ skills: ['passive'], level: 12 }] },
    },
};
const steps = skillSteps(skillData, heroes, 'warrior');

test("the steps: the foundation one skill at a time, hero by hero in the faction order, then each hero's path", () => {
    assert.deepEqual(
        steps.map(({ index, phase, hero, skills, level }) => [index, phase, hero, skills.join('+'), level]),
        [
            // a: the skills in the order a's path names them (ultimate and active, then auto attack), passive last.
            [0, 'foundation', 'a', 'ultimate', 15],
            [1, 'foundation', 'a', 'active', 15],
            [2, 'foundation', 'a', 'auto_attack', 15],
            [3, 'foundation', 'a', 'passive', 15],
            // b: the active, then the skills its path never names, in slot order.
            [4, 'foundation', 'b', 'active', 10],
            [5, 'foundation', 'b', 'auto_attack', 10],
            [6, 'foundation', 'b', 'ultimate', 10],
            [7, 'foundation', 'b', 'passive', 10],
            [8, 'path', 'a', 'ultimate+active', 20],
            [9, 'path', 'a', 'auto_attack', 30],
            [10, 'path', 'b', 'active', 30],
        ],
    );
    assert.deepEqual(
        skillSteps(skillData, heroes, 'ranger').map((step) => step.hero),
        ['c', 'c', 'c', 'c', 'c'],
    );
    assert.deepEqual(skillSteps(skillData, heroes, 'warlock'), [], 'a faction without heroes has no steps');
    assert.equal(foundationLevel(skillData, 'tank'), 10);
    assert.equal(foundationLevel(skillData, 'unknown'), START_LEVEL);
});

test("the foundation has its own order of heroes, apart from the path's", () => {
    const data = { ...skillData, foundation_order: { warrior: ['b', 'a'] } };
    const result = skillSteps(data, heroes, 'warrior');
    assert.deepEqual(
        result.filter((step) => step.phase === 'foundation').map((step) => step.hero),
        ['b', 'b', 'b', 'b', 'a', 'a', 'a', 'a'],
    );
    assert.deepEqual(
        result.filter((step) => step.phase === 'path').map((step) => step.hero),
        ['a', 'a', 'b'],
    );
});

test('the levels after some steps: targets, a skill that is further stays, unnamed skills stay at the foundation', () => {
    assert.deepEqual(skillLevels(steps, 0).a, { auto_attack: 1, active: 1, ultimate: 1, passive: 1 });
    assert.deepEqual(skillLevels(steps, 2).a, { auto_attack: 1, active: 15, ultimate: 15, passive: 1 });
    assert.deepEqual(skillLevels(steps, 4).a, { auto_attack: 15, active: 15, ultimate: 15, passive: 15 });
    assert.deepEqual(skillLevels(steps, 9).a, { auto_attack: 15, active: 20, ultimate: 20, passive: 15 });
    const done = skillLevels(steps, steps.length);
    assert.deepEqual(done.a, { auto_attack: 30, active: 20, ultimate: 20, passive: 15 });
    assert.deepEqual(
        done.b,
        { auto_attack: 10, active: 30, ultimate: 10, passive: 10 },
        "a tank's basic attack stays at 10",
    );
    // A step below what a skill has is no change.
    const lower = [...steps, { index: 11, phase: 'path', hero: 'a', skills: ['ultimate'], level: 12 }];
    assert.equal(skillLevels(lower, lower.length).a.ultimate, 20);
});

test('what the next step changes: only the skills below its target; null when everything is done', () => {
    assert.deepEqual(nextChange(steps, 0, skillLevels(steps, 0)), { hero: 'a', slots: ['ultimate'], level: 15 });
    assert.deepEqual(nextChange(steps, 8, skillLevels(steps, 8)), {
        hero: 'a',
        slots: ['ultimate', 'active'],
        level: 20,
    });
    // Done out of the guide's order isn't possible, but a skill already at the target is left out.
    const ahead = { a: { auto_attack: 30, active: 1, ultimate: 1, passive: 1 } };
    assert.deepEqual(nextChange(steps, 9, ahead).slots, []);
    assert.equal(nextChange(steps, steps.length, skillLevels(steps, steps.length)), null);
});

test('the skill cap by awakening level', () => {
    assert.equal(skillCap(skillData, 0), 30);
    assert.equal(skillCap(skillData, 2), 30);
    assert.equal(skillCap(skillData, 3), 31);
    assert.equal(skillCap(skillData, 6), 31);
    assert.equal(skillCap(skillData, 7), 32);
    assert.equal(skillCap(skillData, 39), 32);
    assert.equal(skillCap(skillData, 40), 40);
});

test('a description as text and level numbers, with the next one and the "%" unit, null for what is not known', () => {
    const values = { damage: [null, 10, 12.5], other: [1, 2, 3] };
    const text = 'Deals {damage}% ATK and {other} stacks';
    assert.deepEqual(describeSkill(text, values, 2, 2), [
        'Deals ',
        { sign: '', now: 10, next: null, unit: '%' },
        ' ATK and ',
        { sign: '', now: 2, next: null, unit: '' },
        ' stacks',
    ]);
    assert.deepEqual(describeSkill(text, values, 2, 3), [
        'Deals ',
        { sign: '', now: 10, next: 12.5, unit: '%' },
        ' ATK and ',
        { sign: '', now: 2, next: 3, unit: '' },
        ' stacks',
    ]);
    assert.deepEqual(
        describeSkill(text, values, 1, 2),
        [
            'Deals ',
            { sign: '', now: null, next: null, unit: '%' },
            ' ATK and ',
            { sign: '', now: 1, next: 2, unit: '' },
            ' stacks',
        ],
        'level 1 of damage is unknown, so there is no next either',
    );
    assert.deepEqual(
        describeSkill('{other}', values, 9, 9),
        [{ sign: '', now: null, next: null, unit: '' }],
        'beyond the list; no text around it',
    );
    assert.deepEqual(
        describeSkill('ATK +{atk}%, 5 + {x}', { atk: [20, 25], x: [1] }, 1, 2),
        ['ATK ', { sign: '+', now: 20, next: 25, unit: '%' }, ', 5 + ', { sign: '', now: 1, next: null, unit: '' }],
        'a "+" right before the placeholder is part of the number, a spaced one is text',
    );
    assert.deepEqual(describeSkill('Always 20%', undefined, 3, 4), ['Always 20%']);
    assert.deepEqual(
        describeSkill('{x} and {y}', { x: [5, 5] }, 1, 2),
        [{ sign: '', now: 5, next: null, unit: '' }, ' and ', { sign: '', now: null, next: null, unit: '' }],
        'the same value on both levels has no next; a placeholder without values is unknown',
    );
});

test('a single number is the same at every level, with no next', () => {
    assert.deepEqual(describeSkill('Lasts {duration}s', { duration: 3 }, 5, 10), [
        'Lasts ',
        { sign: '', now: 3, next: null, unit: '' },
        's',
    ]);
});

test('a skill with all its star bonuses: a later bonus on a number replaces the earlier, add follows scale', () => {
    const skill = {
        description: { en: 'Deals {damage}% for {duration}s' },
        values: { damage: [87.16, null, 90], duration: 3, targets: [2] },
        star_bonuses: [
            { stars: 10, text: { en: 'three' }, scale: { damage: 200 } },
            { stars: 1, text: { en: 'one' }, scale: { damage: 40 }, add: { duration: 1 } },
            { stars: 5, text: { en: 'five' }, scale: { damage: 100 } },
        ],
    };
    const { description, values, bonuses } = starredSkill(skill);
    assert.deepEqual(
        values.damage,
        [261.5, null, 270],
        'the 10-star bonus counts: x3, rounded to one decimal; unknown stays',
    );
    assert.equal(values.duration, 4, 'the only bonus on it');
    assert.deepEqual(values.targets, [2], 'a number no bonus names is as entered');
    assert.equal(description, skill.description);
    assert.deepEqual(
        bonuses.map((bonus) => bonus.stars),
        [1, 5, 10],
        'in the order of the stars',
    );
    assert.deepEqual(skill.values.damage, [87.16, null, 90], 'the skill itself is not changed');
});

test('a bonus with its own description replaces the skill text; a skill without bonuses is unchanged', () => {
    const skill = {
        description: { en: 'Hits {damage}%' },
        values: { damage: [10] },
        star_bonuses: [
            { stars: 2, text: { en: 'a' }, description: { en: 'Hits {damage}% and stuns' } },
            { stars: 6, text: { en: 'b' }, description: { en: 'Hits {damage}% and stuns for {stun}s' } },
        ],
    };
    assert.deepEqual(starredSkill(skill).description, { en: 'Hits {damage}% and stuns for {stun}s' });
    const plain = { description: { en: 'Hits {damage}%' }, values: { damage: [10] } };
    assert.deepEqual(starredSkill(plain), { description: plain.description, values: { damage: [10] }, bonuses: [] });
    assert.deepEqual(starredSkill({ description: { en: 'x' } }).values, {});
});
