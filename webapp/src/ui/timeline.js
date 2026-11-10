/**
 * The Calendar's charts, drawn on the user's local days (columns from local midnight to midnight, 23 or 25 hours long
 * where the clocks change): a bar sits where its moments (ms) fall, so a run that starts at the game day's reset
 * begins part-way into a column. Everything is placed by a share of the chart's view `{ from, to }` (ms), so the
 * header columns (`columnsStyle`), the lines (`gridHtml`), the bars (`barHtml`) and the "now" line agree.
 */
import { t } from './i18n.js';
import { escapeHtml } from './html.js';
import { formatDate } from './datetime.js';
import { DAY_MS, HOUR_MS, dayStartMs, gameDay } from '../core/schedule.js';

/** The local midnights that start `count` days from the local day of `startMs`, and the one that ends the last (`count + 1`). */
function localDayBoundaries(startMs, count) {
    const start = new Date(startMs);
    return Array.from({ length: count + 1 }, (_, index) =>
        new Date(start.getFullYear(), start.getMonth(), start.getDate() + index).getTime(),
    );
}

/** The local midnight that starts the Monday of the local week `ms` falls in. */
function localWeekStart(ms) {
    const date = new Date(ms);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7)).getTime();
}

/** The local date of a moment as a day number (days since 1970-01-01), as `isoWeekNumber` takes it. */
function localDayNumber(ms) {
    const date = new Date(ms);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

/** A chart's view: `{ from, to }` (ms), from the start of its first day to the end of its last. */
function viewOf(boundaries) {
    return { from: boundaries[0], to: boundaries[boundaries.length - 1] };
}

/** How far a moment is into the view, 0 to 1. */
function shareOf(ms, { from, to }) {
    return (ms - from) / (to - from);
}

/** Where a moment is in the view, in percent. */
function percentOf(ms, view) {
    return shareOf(ms, view) * 100;
}

/**
 * The chart's attributes: how wide its first column is (`--week-width`, the highlighted current day / week, `span`
 * days), where now is (`--today`, kept current by `shareOf`) and, as `data-*`, its view and when to draw it again:
 * at the next game day (the runs' status moves on), when its first column is over, or at `refreshAt` if that is sooner.
 */
function chartAttrs(boundaries, span, nowMs, refreshAt = Infinity) {
    const view = viewOf(boundaries);
    const nextReset = dayStartMs(gameDay(new Date(nowMs)).day + 1);
    const refresh = Math.min(nextReset, boundaries[span], refreshAt);
    return `style="--week-width: ${shareOf(boundaries[span], view)}; --today: ${shareOf(nowMs, view)}" data-from="${view.from}" data-to="${view.to}" data-refresh-at="${refresh}"`;
}

/** The header's `grid-template-columns`: a column per `span` days, as wide as its hours (so DST days are right). */
function columnsStyle(boundaries, span) {
    const columns = [];
    for (let index = 0; index + span < boundaries.length; index += span) {
        columns.push(`${(boundaries[index + span] - boundaries[index]) / HOUR_MS}fr`);
    }
    return `grid-template-columns: ${columns.join(' ')}`;
}

/** The day columns of a chart: "Today", "Tomorrow", then the weekday, each with its date. */
function dayHeadersHtml(boundaries) {
    return boundaries
        .slice(0, -1)
        .map((ms, index) => {
            const label =
                index < 2
                    ? t(index === 0 ? 'calendar.rotation.today' : 'calendar.rotation.tomorrow')
                    : formatDate(ms, { weekday: 'long' });
            return `
                <div class="schedule__week${index === 0 ? ' schedule__week--current' : ''}">
                    <strong>${escapeHtml(label)}</strong>
                    <span>${escapeHtml(formatDate(ms, { day: 'numeric', month: 'short' }))}</span>
                </div>`;
        })
        .join('');
}

/**
 * A line at every day's start (every `majorEvery`-th one stronger: the week / day columns of the header) and a faint
 * one at each of `minorTicks` (ms).
 */
function gridHtml(boundaries, majorEvery, minorTicks = []) {
    const view = viewOf(boundaries);
    const lines = [
        ...minorTicks.map((ms) => `<i style="left: ${percentOf(ms, view)}%"></i>`),
        ...boundaries
            .slice(0, -1)
            .map(
                (ms, index) =>
                    `<i${index % majorEvery === 0 ? ' class="schedule__grid-major"' : ''} style="left: ${percentOf(ms, view)}%"></i>`,
            ),
    ];
    return `<div class="schedule__grid" aria-hidden="true">${lines.join('')}</div>`;
}

/**
 * A bar from `bar.start` to `bar.end` (ms); with `href` a link (opens its plan; `action` is its label in the card: a
 * hint on hover, a button once a tap has pinned the card, see tooltip.js), with `image` the hover card shows the
 * art, greyed for an ended run (or where `mutedImage` says). A bar cut by the view's edge fades there.
 */
function barHtml(
    bar,
    view,
    tooltip,
    { href = null, action = null, image = null, color = null, mutedImage = bar.past } = {},
) {
    const start = Math.max(bar.start, view.from);
    const end = Math.min(bar.end, view.to);
    const classes = [
        'schedule__bar',
        bar.forecast ? 'schedule__bar--forecast' : '',
        bar.forecast && !bar.proven ? 'schedule__bar--guess' : '',
        bar.past ? 'schedule__bar--past' : '',
        bar.active ? 'schedule__bar--active' : '',
        bar.start < view.from ? 'schedule__bar--cut-start' : '',
        bar.end > view.to ? 'schedule__bar--cut-end' : '',
    ].filter(Boolean);
    // A 1px inset on both ends (2px gap between bars that meet), none where the view cuts the bar.
    const insetStart = bar.start < view.from ? 0 : 1;
    const insetEnd = bar.end > view.to ? 0 : 1;
    const width = ((end - start) / (view.to - view.from)) * 100;
    const style = `left: calc(${percentOf(start, view)}% + ${insetStart}px); width: calc(${width}% - ${insetStart + insetEnd}px)${color ? `; --bar-color: ${color}` : ''}`;
    const tag = href ? 'a' : 'span';
    const linkAttrs = href ? ` href="${escapeHtml(href)}"` : ' tabindex="0" role="img"';
    // An ended run's art greyed in its hover card, as its bar (`mutedImage`: greyed for other bars too).
    const imageAttr = image
        ? ` data-tooltip-image="${escapeHtml(image)}"${mutedImage ? ' data-tooltip-image-muted' : ''}`
        : '';
    const actionAttr = href && action ? ` data-tooltip-action="${escapeHtml(action)}"` : '';
    return `<${tag} class="${classes.join(' ')}" style="${style}"${linkAttrs} aria-label="${escapeHtml(tooltip)}" data-tooltip="${escapeHtml(tooltip)}"${actionAttr}${imageAttr}></${tag}>`;
}

export {
    localDayBoundaries,
    localWeekStart,
    localDayNumber,
    viewOf,
    shareOf,
    percentOf,
    chartAttrs,
    columnsStyle,
    dayHeadersHtml,
    gridHtml,
    barHtml,
};
