import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveItemValues, bundleValue } from '../webapp/src/core/item-values.js';

// Base points (as point-fit.js would give them) for the leaves of the small item set below.
const basePoints = new Map([
    ['gem', { value: 10, source: 'fit' }],
    ['ore', { value: 2, source: 'fit' }],
    ['steel', { value: 16, source: 'fit' }],
]);

const items = {
    gem: {},
    ore: {},
    unknown_leaf: {},
    coin: {},
    // Containers.
    gem_bag: { contains: { gem: 3, ore: 5 } },
    mixed_bag: { contains: { gem: 1, unknown_leaf: 1 } },
    lucky_box: {
        type: 'random',
        drop_table: [
            { probability: 0.25, contains: { gem: 4 } },
            { probability: 0.75, contains: { ore: 2 } },
        ],
    },
    pick_box: { type: 'choice', choice: { select_count: 1, choices: [{ ore: 3 }, { gem: 1 }, { ore: 1, gem: 1 }] } },
    pick_two: { type: 'choice', choice: { select_count: 2, choices: [{ ore: 3 }, { gem: 1 }, { ore: 1, gem: 1 }] } },
    omni_gem: { substitutes_for: ['gem', 'ore'] },
    // Reversible chain: 4 iron = 1 steel (steel valued, iron gets steel / 4).
    iron: {},
    steel: { contains: { iron: 4 }, reversible: true },
    // Value level chain and recipe.
    gem_lv2: { value_equivalent: { gem: 9 } },
    crafted: { crafted_from: { ore: 6 } },
};

const values = resolveItemValues(items, {
    basePoints,
    currencyIds: new Set(['coin']),
    currencyValues: { coin: 0.5 },
    weights: { ore: 0.5 },
});
const value = (id) => values.get(id).value;

test('structure: contains, random, choice, substitute', () => {
    // Weights apply after the fit: ore counts half (2 * 0.5 = 1).
    assert.equal(value('ore'), 1);
    assert.equal(value('gem_bag'), 3 * 10 + 5 * 1);
    assert.equal(value('lucky_box'), 0.25 * 40 + 0.75 * 2);
    assert.equal(value('pick_box'), 11, 'best option: ore + gem');
    assert.deepEqual(values.get('pick_box').picked, [2]);
    assert.equal(value('pick_two'), 11 + 10);
    assert.equal(value('omni_gem'), 10, 'best target');
});

test('reversible chains, value levels and recipes', () => {
    assert.equal(value('steel'), 16);
    assert.equal(value('iron'), 4, 'lent down the chain: 16 / 4');
    assert.equal(values.get('iron').source, 'reversible');
    assert.equal(value('gem_lv2'), 90);
    assert.equal(value('crafted'), 6, 'no pack prices it: worth its recipe');
});

test('currencies and unknown parts', () => {
    assert.equal(value('coin'), 0.5);
    assert.equal(value('unknown_leaf'), null);
    assert.equal(value('mixed_bag'), 10, 'unknown parts count as 0 ...');
    assert.equal(values.get('mixed_bag').incomplete, true, '... and mark the result incomplete');
});

test('bundleValue: contents plus the best choice options', () => {
    const b = bundleValue({ contains: { gem: 2 }, choice: { choices: [{ ore: 1 }, { gem: 1 }] } }, values);
    assert.equal(b.value, 30);
    assert.deepEqual(b.picked, [1]);
    assert.equal(b.incomplete, false);
    assert.equal(bundleValue({}, values).value, 0);
});
