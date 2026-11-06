import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandPackageFamilies } from '../../webapp/src/core/pack-data.js';
import { createModel } from '../../webapp/src/core/lp.js';
import { addPackageRules } from '../../webapp/src/core/package-rows.js';

/** The package variables as the programs make them: capacity 2, one purchase per unit. */
function rulesFor(rawPackages, capacity = 2) {
    const packages = expandPackageFamilies(rawPackages);
    const vars = new Map(
        Object.entries(packages).map(([id, pkg]) => [id, { name: `p_${id}`, pkg, capacity, coefficient: 1 }]),
    );
    const model = createModel('max');
    addPackageRules(model, vars, packages);
    return model;
}
const names = (model) => model.rows.map((row) => row.name);

test('a ladder tier is bought at most as often as the tier below', () => {
    const model = rulesFor({ ladder: { tiers: { 1: { price: 100 }, 2: { price: 200 } } } });
    const link = model.rows.find((row) => row.name.startsWith('req__'));
    assert.ok(link, 'tier 2 is tied to tier 1');
    assert.equal(link.op, '<=');
});

test('a tier whose paid lower tier is not offered cannot be bought at all', () => {
    const packages = expandPackageFamilies({ ladder: { tiers: { 1: { price: 100 }, 2: { price: 200 } } } });
    const vars = new Map([['ladder_t2', { name: 'p_t2', pkg: packages.ladder_t2, capacity: 2, coefficient: 1 }]]);
    const model = createModel('max');
    addPackageRules(model, vars, packages);
    assert.deepEqual(model.bounds.get('p_t2'), { lower: 0, upper: 0 });
});

test('only one pack of an exclusive group is bought per period', () => {
    const model = rulesFor({
        a: { price: 100, exclusive_group: 'calendar' },
        b: { price: 100, exclusive_group: 'calendar' },
        c: { price: 100 },
    });
    const row = model.rows.find((r) => r.name.startsWith('grp__'));
    assert.deepEqual([...row.terms.keys()].sort(), ['p_a', 'p_b']);
    assert.equal(row.rhs, 2);
});

test('a bundle excludes the packs it includes', () => {
    const model = rulesFor({ pass: { price: 100, bundles: ['single'] }, single: { price: 50 } });
    assert.ok(names(model).some((name) => name.startsWith('bdl__')));
});

test('packs without rules add no rows', () => {
    assert.deepEqual(rulesFor({ a: { price: 100 }, b: { price: 50 } }).rows, []);
});
