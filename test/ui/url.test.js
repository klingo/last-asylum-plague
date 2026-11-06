import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventPlanHref, itemSourcesHref, pageHref } from '../../webapp/src/ui/url.js';

test('a page link carries its selection, URL-encoded, below the site base', () => {
    assert.equal(pageHref('events', { event: 'event:x y' }), '/events.html?event=event%3Ax%20y');
    assert.equal(pageHref('compare', { a: 'gem', an: 5 }), '/compare.html?a=gem&an=5');
});

test('links to Item Sources and to an event on Event Shops', () => {
    assert.equal(itemSourcesHref('a b'), '/sources.html?item=a%20b');
    assert.equal(eventPlanHref('mine'), '/events.html?event=event%3Amine');
});
