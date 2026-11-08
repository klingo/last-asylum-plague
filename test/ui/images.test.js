import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createItemImage, packageImageUrl, setItemImageAliases } from '../../webapp/src/ui/images.js';

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

test("a package's own picture is assets/packages/<pack id>.webp, the id encoded", () => {
    assert.match(packageImageUrl('awakening_special_pack'), /assets\/packages\/awakening_special_pack\.webp$/);
    assert.match(packageImageUrl('odd id/with?chars'), /assets\/packages\/odd%20id%2Fwith%3Fchars\.webp$/);
});
