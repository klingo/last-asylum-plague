import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeLabelKeys, missingCodeLabels } from '../../scripts/lib/code-labels.js';

const data = {
    items: { gem: { category: 'material' }, junk: { category: '-' }, bare: {} },
    packages: { pack: { category: 'weekly_pass' } },
    events: { e: { category: 'special_event' } },
    exchange_shops: { s: { category: 'shop' } },
    heroes: { h: { class: 'tank', faction: 'warrior' } },
    squad_guides: { g: { slots: { a: { class: 'carry', heroes: { ranger: 'x' } } } } },
};

/** `{ 'a.b': 'x' }` as `{ a: { b: 'x' } }`. */
function nest(flat) {
    const tree = {};
    for (const [key, text] of Object.entries(flat)) {
        const parts = key.split('.');
        const last = parts.pop();
        parts.reduce((node, part) => (node[part] ??= {}), tree)[last] = text;
    }
    return tree;
}

test('the labels a dataset needs: categories, hero codes, weekdays, purchase types and the picker groups', () => {
    const keys = codeLabelKeys(data);
    for (const key of [
        'category.material',
        'category.weekly_pass',
        'category.special_event',
        'category.shop',
        'category.spend_track',
        'category.seasonal_pass',
        'category.other',
        'gear.class.tank',
        'gear.class.carry',
        'gear.faction.warrior',
        'gear.faction.ranger',
        'weekday.monday',
        'weekdayShort.monday',
        'sourceType.event',
        'skills.slot.ultimate',
        'skills.slot.tenacity',
        'skills.damage.energy',
        'skills.damage.physical',
    ]) {
        assert.ok(keys.includes(key), key);
    }
    assert.ok(!keys.some((key) => key.endsWith('.-') || key === 'category.undefined'), 'no code, no label');
    assert.deepEqual(keys, [...keys].sort(), 'sorted');
});

test('the missing labels are the ones the dictionary has no text for', () => {
    const everything = Object.fromEntries(codeLabelKeys(data).map((key) => [key, 'x']));
    assert.deepEqual(missingCodeLabels(data, nest(everything)), []);
    const without = { ...everything, 'category.material': '', 'weekday.monday': '  ' };
    delete without['gear.class.tank'];
    assert.deepEqual(missingCodeLabels(data, nest(without)), [
        'category.material',
        'gear.class.tank',
        'weekday.monday',
    ]);
});
