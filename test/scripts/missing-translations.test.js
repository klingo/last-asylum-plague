import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingDataNames, missingUiTexts } from '../../scripts/missing-translations.js';

test('a UI text is missing when English has it and the language has none or an empty one', () => {
    const english = { a: 'A', group: { b: 'B', c: 'C', d: '   ' }, e: 'E' };
    const german = { a: 'Ä', group: { b: '', c: 'Z' } };
    assert.deepEqual(missingUiTexts(english, german), [
        { key: 'group.b', english: 'B' },
        { key: 'e', english: 'E' },
    ]);
});

test('a whole group the language lacks is missing text by text, blank English is not', () => {
    const english = { a: 'A', group: { b: 'B', c: 'C', d: '   ' } };
    assert.deepEqual(
        missingUiTexts(english, undefined).map(({ key }) => key),
        ['a', 'group.b', 'group.c'],
    );
});

test('a data name is missing when its language value is absent or blank', () => {
    const data = {
        items: { gem: { name: { en: 'Gem', de: 'Edelstein' } }, ore: { name: { en: 'Ore', de: '' } } },
        events: { e: { name: { en: 'Event' }, description: { en: 'About' } } },
        other: { name: { en: '' } },
    };
    assert.deepEqual(missingDataNames(data, 'de'), [
        { key: 'items.ore.name', english: 'Ore' },
        { key: 'events.e.name', english: 'Event' },
        { key: 'events.e.description', english: 'About' },
    ]);
    assert.deepEqual(missingDataNames(null, 'de'), []);
});
