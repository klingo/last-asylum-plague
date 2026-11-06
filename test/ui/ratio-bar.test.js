import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratioBarHtml, ratioCellHtml, ratioColor, ratioScale } from '../../webapp/src/ui/ratio-bar.js';

test('the bar scale is the highest ratio, at least 1, skipping missing ones', () => {
    assert.equal(ratioScale([0.5, null, 2.5, Number.NaN, undefined]), 2.5);
    assert.equal(ratioScale([0.2, 0.9]), 1);
    assert.equal(ratioScale([]), 1);
});

test('the colour runs red, amber at 1.0, green from 1.15', () => {
    assert.equal(ratioColor(0.5), 'rgb(242, 104, 92)');
    assert.equal(ratioColor(1), 'rgb(242, 193, 78)');
    assert.equal(ratioColor(2), 'rgb(99, 214, 138)');
});

test('the bar shows the ratio and fills relative to the scale', () => {
    const html = ratioBarHtml(1.5, 3, { digits: 2 });
    assert.match(html, />1\.50<\/span>/);
    assert.match(html, /width: 50\.0%/);
    assert.equal(ratioBarHtml(Number.NaN, 3), '');
    assert.match(ratioBarHtml(0.5, 1, { label: '50 %' }), />50 %<\/span>/);
});

test('a cell without a ratio shows a dash, one with it the bar with 3 digits', () => {
    assert.equal(ratioCellHtml(null, 2), '-');
    assert.equal(ratioCellHtml(undefined, 2), '-');
    assert.match(ratioCellHtml(1.2345, 2), />1\.234<\/span>/);
});
