import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    barHtml,
    chartAttrs,
    columnsStyle,
    dayHeadersHtml,
    gridHtml,
    localDayBoundaries,
    localDayNumber,
    localWeekStart,
    percentOf,
    shareOf,
    viewOf,
} from '../../webapp/src/ui/timeline.js';
import { isoWeekNumber } from '../../webapp/src/core/schedule.js';
import { day } from '../helpers.js';

// A zone that changes its clocks (Oct 25, 2026: 03:00 -> 02:00), so one day of the window has 25 hours.
process.env.TZ = 'Europe/Zurich';

const HOUR = 3600000;
// Sat Oct 24 .. Mon Nov 2, 2026, as local midnights.
const boundaries = localDayBoundaries(new Date(2026, 9, 24, 15).getTime(), 9);
const view = viewOf(boundaries);

test('local days start at local midnight, a day is 25 hours long where the clocks go back', () => {
    assert.equal(boundaries.length, 10);
    assert.equal(boundaries[0], new Date(2026, 9, 24).getTime());
    assert.equal(boundaries[1] - boundaries[0], 24 * HOUR);
    assert.equal(boundaries[2] - boundaries[1], 25 * HOUR, 'Sun Oct 25');
    assert.equal(boundaries[3] - boundaries[2], 24 * HOUR);
});

test('the week starts on the local Monday, the date is the local one', () => {
    // Sun Nov 1 23:30 local is Monday's week of Oct 26; Mon Nov 2 00:10 starts the next one.
    assert.equal(localWeekStart(new Date(2026, 10, 1, 23, 30).getTime()), new Date(2026, 9, 26).getTime());
    assert.equal(localWeekStart(new Date(2026, 10, 2, 0, 10).getTime()), new Date(2026, 10, 2).getTime());
    assert.equal(localDayNumber(new Date(2026, 10, 2, 0, 10).getTime()), day(0));
    assert.equal(isoWeekNumber(localDayNumber(new Date(2026, 10, 2).getTime())), 45);
});

test('a moment is a share of the view', () => {
    assert.equal(shareOf(view.from, view), 0);
    assert.equal(shareOf(view.to, view), 1);
    assert.equal(percentOf(boundaries[1], view), ((24 * HOUR) / (view.to - view.from)) * 100);
});

test('header columns are as wide as their hours', () => {
    assert.equal(columnsStyle(boundaries, 1), 'grid-template-columns: 24fr 25fr 24fr 24fr 24fr 24fr 24fr 24fr 24fr');
    assert.equal(columnsStyle(boundaries, 3), 'grid-template-columns: 73fr 72fr 72fr');
});

test('the lines sit at the days, every major one stronger', () => {
    const html = gridHtml(boundaries, 7, [boundaries[1] + 12 * HOUR]);
    assert.equal(html.match(/<i/g).length, 9 + 1, 'a line per day (not the end) and the minor tick');
    assert.equal(html.match(/schedule__grid-major/g).length, 2, 'the days 0 and 7');
    assert.match(html, /style="left: 0%"/);
});

test('day headers: today, tomorrow, then the weekday', () => {
    const html = dayHeadersHtml(boundaries);
    assert.equal(html.match(/schedule__week/g).length, 9 + 1, 'a header each, the first also --current');
    assert.match(html, /schedule__week schedule__week--current/);
    assert.match(html, /<strong>Today<\/strong>\s*<span>Oct 24<\/span>/);
    assert.match(html, /<strong>Tuesday<\/strong>\s*<span>Oct 27<\/span>/);
});

test('a bar sits at its moments; where the view cuts it, it has no inset and fades', () => {
    const inside = barHtml({ start: boundaries[2], end: boundaries[4] }, view, 'Offer');
    const width = ((boundaries[4] - boundaries[2]) / (view.to - view.from)) * 100;
    assert.match(inside, new RegExp(`left: calc\\(${percentOf(boundaries[2], view)}% \\+ 1px\\)`));
    assert.match(inside, new RegExp(`width: calc\\(${width}% - 2px\\)`));
    assert.doesNotMatch(inside, /cut-/);

    const cutStart = barHtml({ start: view.from - HOUR, end: boundaries[1] }, view, 'Offer');
    assert.match(cutStart, /schedule__bar--cut-start/);
    assert.match(cutStart, /left: calc\(0% \+ 0px\)/);
    assert.doesNotMatch(cutStart, /cut-end/);

    const cutEnd = barHtml({ start: boundaries[8], end: view.to + HOUR }, view, 'Offer');
    assert.match(cutEnd, /schedule__bar--cut-end/);
    assert.match(cutEnd, /- 1px\)/);
});

test('a bar is a link with a href, takes its state and colour, and escapes its text', () => {
    const bar = { start: boundaries[0], end: boundaries[1], past: true, forecast: true };
    const html = barHtml(bar, view, 'A "quoted" <offer>', { href: '?a=1&b=2', image: 'x.webp', color: 'red' });
    assert.match(html, /^<a class="schedule__bar schedule__bar--forecast schedule__bar--guess schedule__bar--past"/);
    assert.match(html, /href="\?a=1&amp;b=2"/);
    assert.match(html, /data-tooltip="A &quot;quoted&quot; &lt;offer&gt;"/);
    assert.match(html, /data-tooltip-image-muted/);
    assert.match(html, /--bar-color: red/);
    assert.doesNotMatch(html, /data-tooltip-action/);
    assert.match(
        barHtml(bar, view, 'x', { href: '?a=1', action: 'Open "it"' }),
        /data-tooltip-action="Open &quot;it&quot;"/,
    );
    assert.doesNotMatch(barHtml(bar, view, 'x', { action: 'Open' }), /data-tooltip-action/); // no link, no action
    assert.match(
        barHtml({ ...bar, past: false, proven: true }, view, 'x'),
        /^<span class="schedule__bar schedule__bar--forecast"/,
    );
});

test('a chart draws again at the next game day, when its first column is over, or sooner if asked', () => {
    // Sat Oct 24, 15:00 local (13:00 UTC): the next reset is 02:00 UTC on Oct 25, 04:00 local; its first day ends at midnight.
    const nowMs = new Date(2026, 9, 24, 15).getTime();
    const refresh = (attrs) => Number(attrs.match(/data-refresh-at="(\d+)"/)[1]);
    assert.equal(refresh(chartAttrs(boundaries, 1, nowMs)), boundaries[1]);
    assert.equal(refresh(chartAttrs(boundaries, 7, nowMs)), Date.UTC(2026, 9, 25, 2));
    assert.equal(refresh(chartAttrs(boundaries, 1, nowMs, nowMs + HOUR)), nowMs + HOUR);
    const attrs = chartAttrs(boundaries, 1, nowMs);
    assert.match(attrs, new RegExp(`data-from="${view.from}" data-to="${view.to}"`));
    assert.match(attrs, new RegExp(`--today: ${shareOf(nowMs, view)}`));
    assert.match(attrs, new RegExp(`--week-width: ${shareOf(boundaries[1], view)}`));
});
