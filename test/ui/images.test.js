import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createItemImage, setItemImageAliases } from '../../webapp/src/ui/images.js';

// The stand-in browser has no elements: a bare <img> that keeps its class names, like the real one's classList.
globalThis.document.createElement = () => {
    const classes = new Set();
    return {
        classes,
        set className(value) {
            classes.clear();
            value.split(' ').forEach((name) => classes.add(name));
        },
        classList: { add: (name) => classes.add(name) },
    };
};

setItemImageAliases({
    gold: { category: 'material', rarity: 'ur', name: { en: 'Gold' } },
    plain: { category: 'resource', name: { en: 'Plain' } },
});

/** What the page does when the file `img.src` points to does not exist. */
const fail = (img) => img.onerror();

test('an item icon starts at its category folder, then the unsorted folder, then the placeholder', () => {
    const img = createItemImage('gold', 'Gold');
    assert.match(img.src, /assets\/items\/material\/gold\.png$/);
    assert.equal(img.title, 'Gold');
    assert.ok(img.classes.has('item-icon') && img.classes.has('item-icon--ur'));
    fail(img);
    assert.match(img.src, /assets\/items\/gold\.png$/);
    fail(img);
    assert.match(img.src, /placeholder-item\.svg$/);
    assert.ok(img.classes.has('item-icon--placeholder'));
});

test('a package picture comes first, then the icon item as always', () => {
    const img = createItemImage('gold', 'Gold', 'item-icon item-icon--sm', 'awakening_special_pack');
    assert.match(img.src, /assets\/packages\/awakening_special_pack\.webp$/);
    // while it is the pack's own picture: neither the item's rarity border nor its name
    assert.equal(img.title, undefined);
    assert.ok(!img.classes.has('item-icon--ur') && img.classes.has('item-icon--sm'));
    fail(img); // no such picture: the item's icon, with its border and name
    assert.match(img.src, /assets\/items\/material\/gold\.png$/);
    assert.equal(img.title, 'Gold');
    assert.ok(img.classes.has('item-icon--ur'));
    fail(img);
    assert.match(img.src, /assets\/items\/gold\.png$/);
    fail(img);
    assert.match(img.src, /placeholder-item\.svg$/);
});

test('a pack id is encoded in the picture URL, and an unknown icon item still ends at the placeholder', () => {
    const img = createItemImage('nothing', 'x', 'item-icon', 'odd id/with?chars');
    assert.match(img.src, /assets\/packages\/odd%20id%2Fwith%3Fchars\.webp$/);
    fail(img);
    assert.match(img.src, /placeholder-item\.svg$/);
});
