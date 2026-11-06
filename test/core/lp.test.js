import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModel, addTerm, toLpText, varName, solveModel, loadHighs } from '../../webapp/src/core/lp.js';

test('lp: text format and a tiny solve', async () => {
    const model = createModel('max');
    const x = varName('p', 'pack-1');
    assert.equal(x, 'p__pack_1');
    addTerm(model.objective, x, 3);
    addTerm(model.objective, 'y', 2);
    addTerm(model.objective, 'y', 0);
    model.rows.push({
        name: 'budget',
        terms: new Map([
            [x, 1],
            ['y', 1],
        ]),
        op: '<=',
        rhs: 4,
    });
    model.bounds.set(x, { upper: 2.5 });
    model.integers.add(x);
    const text = toLpText(model);
    assert.match(text, /^Maximize\n obj: 3 p__pack_1 \+ 2 y\n/);
    assert.match(text, / budget: 1 p__pack_1 \+ 1 y <= 4\n/);
    assert.match(text, / 0 <= p__pack_1 <= 2\.5\n 0 <= y <= \+inf\n/);
    assert.match(text, /Generals\n p__pack_1\n/);

    const result = solveModel(await loadHighs(), model);
    assert.equal(result.status, 'Optimal');
    assert.equal(result.values.get(x), 2);
    assert.equal(result.values.get('y'), 2);
    assert.equal(result.objective, 10);
});
