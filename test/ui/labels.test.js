import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    bundleLabel,
    conversionLabel,
    itemDisplayName,
    itemDisplayText,
    itemLinkHtml,
    offerDisplayName,
    packageDisplayName,
    packageDisplayText,
} from '../../webapp/src/ui/labels.js';

const items = {
    diamonds: { name: { en: 'Diamonds' } },
    shard: { name: { en: '<Hero> Shard', de: 'Heldensplitter' } },
    chest: { name: { en: 'Chest' }, contains: { shard: 1 } },
    ore: { name: { en: 'Ore' } },
};

test('an item name is plain text or escaped, the id when the data has none', () => {
    assert.equal(itemDisplayText(items, 'shard', 'en'), '<Hero> Shard');
    assert.equal(itemDisplayName(items, 'shard', 'en'), '&lt;Hero&gt; Shard');
    assert.equal(itemDisplayText(items, 'shard', 'de'), 'Heldensplitter');
    assert.equal(itemDisplayText(items, 'unknown_item', 'en'), 'unknown_item');
    assert.equal(itemDisplayText(undefined, 'x', 'en'), 'x');
});

test('a package name carries the tier suffix of its ladder', () => {
    assert.equal(packageDisplayText({ name: { en: 'Pack' }, tier: 2 }, 'en'), 'Pack (Tier 2)');
    assert.equal(packageDisplayText({ name: { en: 'Pack' } }, 'en'), 'Pack');
    assert.equal(packageDisplayName({ name: { en: 'A & B' } }, 'en'), 'A &amp; B');
});

test('labels of bundles and offers list the escaped names with amounts', () => {
    assert.equal(bundleLabel({ shard: 2, ore: 1000 }, items, 'en'), "&lt;Hero&gt; Shard ×2 + Ore ×1'000");
    const shop = { name: { en: 'Bazaar' } };
    assert.equal(offerDisplayName(shop, { item_id: 'ore', quantity: 10 }, items, 'en'), 'Bazaar - Ore ×10');
});

test('a planner step is described by what it does', () => {
    assert.equal(conversionLabel({ kind: 'open', itemId: 'chest' }, items, 'en'), 'Open Chest');
    assert.equal(
        conversionLabel({ kind: 'substitute', itemId: 'ore', targetId: 'shard' }, items, 'en'),
        'Use Ore as &lt;Hero&gt; Shard',
    );
    assert.match(conversionLabel({ kind: 'craft', itemId: 'chest', ingredients: { ore: 2 } }, items, 'en'), /Ore ×2/);
    assert.match(conversionLabel({ kind: 'pick', itemId: 'chest', option: { shard: 1 } }, items, 'en'), /Shard ×1/);
});

test('an item links to Item Sources unless it has no listing of its own', () => {
    const linked = itemLinkHtml(items, 'ore', 'Ore');
    assert.match(linked, /^<a class="item-link" href="\/sources\.html\?item=ore">Ore<\/a>$/);
    assert.equal(itemLinkHtml(items, 'chest', 'Chest'), 'Chest', 'a container stands for its contents');
});
