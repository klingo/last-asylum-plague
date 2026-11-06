import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChoiceItem, isRandomItem, itemKind, selectCount, substituteTargets } from '../../webapp/src/core/items.js';

test('an item has the first kind that matches', () => {
    assert.equal(itemKind(undefined), null);
    assert.equal(itemKind({ value_equivalent: { a: 1 }, contains: { b: 1 } }), 'equivalent');
    assert.equal(itemKind({ type: 'random', drop_table: [] }), 'random');
    assert.equal(itemKind({ type: 'choice', choice: { choices: [] } }), 'choice');
    assert.equal(itemKind({ contains: { a: 1 }, crafted_from: { b: 1 } }), 'contains');
    assert.equal(itemKind({ substitutes_for: ['a'] }), 'substitute');
    assert.equal(itemKind({ crafted_from: { a: 1 } }), 'recipe');
    assert.equal(itemKind({}), 'leaf');
});

test('a random or choice chest needs its table or pool', () => {
    assert.equal(isRandomItem({ type: 'random' }), false);
    assert.equal(isRandomItem({ type: 'random', drop_table: [{}] }), true);
    assert.equal(isChoiceItem({ type: 'choice' }), false);
    assert.equal(isChoiceItem({ type: 'choice', choice: {} }), true);
    assert.equal(itemKind({ type: 'random', contains: { a: 1 } }), 'contains', 'without a table it is a plain chest');
});

test('a choice picks one option unless it says more', () => {
    assert.equal(selectCount({ choices: [] }), 1);
    assert.equal(selectCount({ choices: [], select_count: 3 }), 3);
    assert.equal(selectCount(undefined), 1);
});

test('what an item substitutes for, as item and amount', () => {
    assert.deepEqual(substituteTargets({ substitutes_for: ['a', 'b'] }), [
        ['a', 1],
        ['b', 1],
    ]);
    assert.deepEqual(substituteTargets({ substitutes_for: { a: 2 } }), [['a', 2]]);
});
