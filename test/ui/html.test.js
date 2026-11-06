import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    banknotesAmount,
    banknotesHtml,
    buyBadge,
    escapeAttr,
    escapeHtml,
    itemIconSlot,
    statHtml,
    tileHtml,
} from '../../webapp/src/ui/html.js';

test('text is escaped for content and double-quoted attributes, apostrophes stay', () => {
    assert.equal(escapeHtml('<Hero> Shard & "Co"'), '&lt;Hero&gt; Shard &amp; &quot;Co&quot;');
    assert.equal(escapeHtml("Attacker's Claw"), "Attacker's Claw");
    assert.equal(escapeHtml(12), '12');
});

test('markup-safe attribute text only has its quotes escaped, so entities are not escaped twice', () => {
    assert.equal(escapeAttr('&lt;b&gt; "x"'), '&lt;b&gt; &quot;x&quot;');
});

test('Banknote amounts are gold with the Banknote icon', () => {
    const html = banknotesHtml("12'345");
    assert.match(html, /^<span class="text-gold">12'345<\/span> <img /);
    assert.equal(banknotesAmount(12345), html);
    assert.match(banknotesAmount(1.5, 2), /1\.50<\/span>/);
});

test('badges, tiles and key figures', () => {
    assert.equal(buyBadge('×3'), '<span class="buy-badge">×3</span>');
    assert.match(tileHtml('Label', 'Body'), /^<div class="plan-tile"><div class="plan-tile__label">Label<\/div>/);
    assert.match(tileHtml('Label', 'Body', true), /plan-tile plan-tile--wide/);
    assert.equal(
        statHtml('Chance', '5 %', 'text-good', 'chance'),
        '<div class="mine-stat"><div class="mine-stat__label">Chance</div><div class="mine-stat__value text-good" id="chance">5 %</div></div>',
    );
    assert.doesNotMatch(statHtml('a', 'b'), / id=/);
});

test('an item icon placeholder carries the escaped id', () => {
    assert.equal(itemIconSlot('a"b'), '<span data-item-id="a&quot;b"></span>');
});
