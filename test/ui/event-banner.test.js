import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hydratePackThumbs, packThumbHtml, thumbHtml } from '../../webapp/src/ui/event-banner.js';

test('a thumbnail is the art, or the placeholder tile without art', () => {
    assert.equal(
        thumbHtml('a&b.webp'),
        '<img class="schedule__thumb" src="a&amp;b.webp" alt="" loading="lazy" decoding="async" />',
    );
    assert.equal(thumbHtml(null), '<span class="schedule__thumb schedule__thumb--none" aria-hidden="true"></span>');
    assert.match(thumbHtml('x.webp', ' data-x'), /^<img class="schedule__thumb" data-x src="x\.webp"/);
});

test("a weekday offer's thumbnail is its picture in assets/packages, marked for hydratePackThumbs", () => {
    assert.match(
        packThumbHtml('awakening_special_pack'),
        /^<img class="schedule__thumb" data-pack-thumb src="[^"]*assets\/packages\/awakening_special_pack\.webp" alt=""/,
    );
});

/** A stand-in <img> under a stand-in root: `state` says how its picture went (loading, loaded, failed). */
function fakeRoot(state) {
    const img = {
        complete: state !== 'loading',
        naturalWidth: state === 'loaded' ? 320 : 0,
        listeners: {},
        replacedBy: null,
        addEventListener(type, listener) {
            this.listeners[type] = listener;
        },
        replaceWith(node) {
            this.replacedBy = node;
        },
    };
    return { img, root: { querySelectorAll: () => [img] } };
}

test('a pack thumbnail whose picture failed before hydration becomes the placeholder at once', () => {
    const placeholder = { tag: 'placeholder' };
    globalThis.document.createElement = () => ({
        set innerHTML(html) {
            this.html = html;
        },
        content: {
            get firstElementChild() {
                return placeholder;
            },
        },
    });
    const { img, root } = fakeRoot('failed');
    hydratePackThumbs(root);
    assert.equal(img.replacedBy, placeholder);
});

test('a pack thumbnail still loading becomes the placeholder only if its picture then fails; a loaded one stays', () => {
    const placeholder = { tag: 'placeholder' };
    globalThis.document.createElement = () => ({
        set innerHTML(html) {
            this.html = html;
        },
        content: {
            get firstElementChild() {
                return placeholder;
            },
        },
    });
    const loading = fakeRoot('loading');
    hydratePackThumbs(loading.root);
    assert.equal(loading.img.replacedBy, null);
    loading.img.listeners.error();
    assert.equal(loading.img.replacedBy, placeholder);

    const loaded = fakeRoot('loaded');
    hydratePackThumbs(loaded.root);
    assert.equal(loaded.img.replacedBy, null); // a picture that is there stays
});
