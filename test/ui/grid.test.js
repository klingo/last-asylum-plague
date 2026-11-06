import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    breakdownParts,
    buyForTiersHtml,
    detailsToggleHtml,
    gridCell,
    gridDetails,
    gridHeader,
    gridNum,
    gridRow,
    gridSection,
    gridTable,
    packPartRowHtml,
} from '../../webapp/src/ui/grid.js';

test('cells, headers and rows carry their classes and roles', () => {
    assert.equal(
        gridCell('x', { num: true, wide: true, className: 'k' }),
        '<div class="ranking-grid__cell ranking-grid__cell--num ranking-grid__cell--wide k" role="cell">x</div>',
    );
    assert.equal(gridNum('1'), '<div class="ranking-grid__cell ranking-grid__cell--num" role="cell">1</div>');
    assert.match(
        gridHeader('Name', { wide: true }),
        /ranking-grid__cell--header ranking-grid__cell--wide" role="columnheader">Name</,
    );
    assert.equal(
        gridRow(['a', 'b'], { buy: true, dim: true }),
        '<div class="ranking-grid__row ranking-grid__row--buy ranking-grid__row--dim" role="row">ab</div>',
    );
    assert.equal(gridRow(['a']), '<div class="ranking-grid__row" role="row">a</div>');
});

test('the table groups its header and body rows, a section heads a group of rows', () => {
    const table = gridTable('H', 'B');
    assert.equal(table.match(/role="rowgroup"/g).length, 2);
    assert.match(gridSection('Bonus'), /ranking-grid__section" role="row"><span role="cell">Bonus</);
});

test('the details button and block follow whether the row is open', () => {
    const open = new Set(['a']);
    assert.match(detailsToggleHtml('a', open), /aria-expanded="true">Hide</);
    assert.match(detailsToggleHtml('b', open), /aria-expanded="false">Details</);
    assert.doesNotMatch(gridDetails('a', open, 'x'), / hidden>/);
    assert.match(gridDetails('b', open, 'x'), / hidden>x</);
    assert.match(detailsToggleHtml('a"b', open), /data-details-for="a&quot;b"/);
});

test('the "for the bonus tiers" note goes under the Buy cell', () => {
    const html = buyForTiersHtml('<span>×1</span>');
    assert.match(
        html,
        /^<span class="buy-stack"><span><span>×1<\/span><\/span><span class="buy-note text-dim">for the bonus tiers/,
    );
    assert.match(html, /class="info-icon"/);
});

// A valuation that knows two items' worth (shard: 10 each; ore: none).
const valuation = {
    worth: (id) => (id === 'shard' ? 10 : null),
    points: (id) => (id === 'shard' ? 5 : 0),
};
const data = { items: { shard: { name: { en: 'Shard' }, category: 'material' }, ore: { name: { en: 'Ore' } } } };

test("a bundle's parts come most valuable first, with the worth of all of them", () => {
    const parts = breakdownParts(
        [
            { id: 'ore', qty: 3 },
            { id: 'shard', qty: 2.5 },
        ],
        data,
        valuation,
    );
    assert.deepEqual(
        parts.map((part) => [part.id, part.unknown]),
        [
            ['shard', false],
            ['ore', true],
        ],
    );
    assert.match(parts[0].item, /Shard<\/a> &times;2\.50<\/span>$/);
    assert.match(parts[0].worth, /25\.00<\/span>/);
    assert.match(parts[0].worthEach, /title="[^"]*5\.00[^"]*"/, 'its points as the mouse-over');
    assert.equal(parts[0].category, 'Materials');
    assert.equal(parts[0].incomplete, '');
    assert.match(parts[1].incomplete, /Incomplete/);
});

test('a part becomes a Details row of a pack table, with or without the Limit column', () => {
    const [part] = breakdownParts([{ id: 'ore', qty: 1 }], data, valuation);
    const cells = (html) => html.match(/role="cell"/g).length;
    assert.equal(cells(packPartRowHtml(part)), 7);
    assert.equal(cells(packPartRowHtml(part, { limitColumn: false })), 6);
    assert.match(packPartRowHtml(part, { dim: true }), /ranking-grid__row--dim/);
    assert.match(packPartRowHtml(part), /Incomplete/);
});
