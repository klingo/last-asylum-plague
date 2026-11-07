/**
 * The Event Schedule: one row per event, pass and track over the next weeks, with their forecasts.
 */
import { formatDays, localizedName, t, tHtml } from '../../ui/i18n.js';
import { escapeHtml } from '../../ui/html.js';
import { formatGameDay, formatGameDayRange } from '../../ui/datetime.js';
import { enableInfoTooltips } from '../../ui/tooltip.js';
import { getSettings } from '../../ui/settings.js';
import { SCHEDULE_KIND_LABELS } from '../../ui/labels.js';
import { eventImageUrl, runStatusText, scheduleHref, scheduleImage, scheduleName } from '../../ui/event-banner.js';
import { gameDay, isoWeekNumber, runStatus, scheduleBars, weekStart } from '../../core/schedule.js';
import { ctx } from './state.js';
import { WEEKS } from './constants.js';

/** "Mon, 12 Oct – Tue, 13 Oct (2 days)" */
function rangeText(start, end) {
    const options = { weekday: 'short', day: 'numeric', month: 'short' };
    const days = end - start + 1;
    const range = formatGameDayRange(start, end, options);
    return `${range} (${days === 1 ? t('calendar.schedule.oneDay') : t('calendar.schedule.days', { count: days })})`;
}

/**
 * A bar's hover card: "Strange Bazaar", the event's own line if it has one (`description`, e.g. its bonus),
 * "Mon, 12 Oct – Sun, 18 Oct (7 days)", "Ends in 3 days" (forecasts with their rhythm), and "Click to open its plan"
 * when it links to one.
 */
function scheduleTooltip(bar, row, today) {
    const lines = [
        row.name,
        ...(row.description ? [row.description] : []),
        rangeText(bar.start, bar.end),
        runStatusText(runStatus([bar], today)),
    ];
    if (bar.forecast) {
        // A proven pattern: its weekdays ("every 7 days (Tue, Thu)") or its gap ("every 28 days"); else a
        // rough guess (no repeating pattern yet), with why when its last record is too old to trust.
        if (!bar.proven) {
            lines.push(t('calendar.schedule.forecastGuessBasis', { interval: bar.intervalDays }));
            if (bar.stale) {
                lines.push(t('calendar.schedule.staleNote'));
            }
        } else if (bar.pattern) {
            lines.push(
                t('calendar.schedule.forecastPattern', {
                    days: bar.pattern.days,
                    weekdays: formatDays(bar.pattern.weekdays),
                }),
            );
        } else {
            lines.push(t('calendar.schedule.forecastBasis', { interval: bar.intervalDays }));
        }
    }
    if (row.href) {
        lines.push(t('calendar.status.openPlan'));
    }
    return lines.join('\n');
}

/** A bar; with `href` a link (opens its plan), with `image` the hover card shows the art. */
function barHtml(bar, from, to, tooltip, { href = null, image = null, color = null } = {}) {
    const start = Math.max(bar.start, from);
    const end = Math.min(bar.end, to);
    const total = to - from + 1;
    const classes = [
        'schedule__bar',
        bar.forecast ? 'schedule__bar--forecast' : '',
        bar.forecast && !bar.proven ? 'schedule__bar--guess' : '',
        bar.past ? 'schedule__bar--past' : '',
        bar.active ? 'schedule__bar--active' : '',
        bar.start < from ? 'schedule__bar--cut-start' : '',
        bar.end > to ? 'schedule__bar--cut-end' : '',
    ].filter(Boolean);
    // A 1px inset on both ends (2px gap between bars on neighbouring days), none where the window cuts the bar.
    const insetStart = bar.start < from ? 0 : 1;
    const insetEnd = bar.end > to ? 0 : 1;
    const style = `left: calc(${((start - from) / total) * 100}% + ${insetStart}px); width: calc(${((end - start + 1) / total) * 100}% - ${insetStart + insetEnd}px)${color ? `; --bar-color: ${color}` : ''}`;
    const tag = href ? 'a' : 'span';
    const linkAttrs = href ? ` href="${escapeHtml(href)}"` : ' tabindex="0" role="img"';
    // An ended run's art greyed in its hover card, as its bar.
    const imageAttr = image
        ? ` data-tooltip-image="${escapeHtml(image)}"${bar.past ? ' data-tooltip-image-muted' : ''}`
        : '';
    return `<${tag} class="${classes.join(' ')}" style="${style}"${linkAttrs} aria-label="${escapeHtml(tooltip)}" data-tooltip="${escapeHtml(tooltip)}"${imageAttr}></${tag}>`;
}

/** The entry's art as a small thumbnail before its name (a placeholder in its group's colour without art). */
function thumbHtml(image) {
    return image
        ? `<img class="schedule__thumb" src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" />`
        : '<span class="schedule__thumb schedule__thumb--none" aria-hidden="true"></span>';
}

/** One line per day (every `perColumn`-th one stronger: the week / day columns of the header). */
function gridHtml(days, perColumn) {
    const lines = Array.from(
        { length: days },
        (_, day) =>
            `<i${day % perColumn === 0 ? ' class="schedule__grid-major"' : ''} style="left: ${(day / days) * 100}%"></i>`,
    );
    return `<div class="schedule__grid" aria-hidden="true">${lines.join('')}</div>`;
}

function renderSchedule() {
    const section = document.getElementById('schedule');
    if (!section || !ctx.packData) {
        return;
    }
    // Today is the game day (it starts at 02:00 UTC), as in the weekday offers.
    const now = gameDay(new Date());
    const today = now.day;
    const from = weekStart(today);
    const to = from + WEEKS * 7 - 1;
    const total = to - from + 1;
    ctx.scheduleWindow = { from, total };

    const rows = scheduleBars(ctx.packData, today, from, to).map(({ id, kind, bars }) => ({
        kind,
        name: scheduleName(ctx.packData, id),
        description: localizedName(ctx.packData.events?.[id]?.description) || null,
        bars,
        first: bars[0].start,
        image: eventImageUrl(scheduleImage(ctx.packData, id)),
        href: scheduleHref(ctx.packData, id, getSettings().activeEvents),
    }));

    const body = section.querySelector('.schedule__body');
    section.hidden = false;
    if (rows.length === 0) {
        body.innerHTML = `<p class="text-dim">${tHtml('calendar.schedule.empty')}</p>`;
        return;
    }

    const weeks = Array.from({ length: WEEKS }, (_, index) => from + index * 7)
        .map(
            (monday) => `
                <div class="schedule__week${monday <= today && today < monday + 7 ? ' schedule__week--current' : ''}">
                    <strong>${tHtml('calendar.schedule.week', { week: isoWeekNumber(monday) })}</strong>
                    <span>${escapeHtml(formatGameDay(monday, { day: 'numeric', month: 'short' }))}</span>
                </div>`,
        )
        .join('');
    const groups = Object.entries(SCHEDULE_KIND_LABELS)
        .map(([kind, labelKey]) => {
            const groupRows = rows
                .filter((row) => row.kind === kind)
                .sort((a, b) => a.first - b.first || a.name.localeCompare(b.name));
            if (groupRows.length === 0) {
                return '';
            }
            // The name (with its art) links to the plan, as the bars do; pointing at either highlights the row.
            const rowsHtml = groupRows
                .map((row) => {
                    const label = `${thumbHtml(row.image)}${escapeHtml(row.name)}`;
                    const bars = row.bars
                        .map((bar) =>
                            barHtml(bar, from, to, scheduleTooltip(bar, row, today), {
                                href: row.href,
                                image: row.image,
                            }),
                        )
                        .join('');
                    return `
                    <div class="schedule__row schedule__row--${kind}">
                        ${
                            row.href
                                ? `<a class="schedule__label schedule__label--link" href="${escapeHtml(row.href)}" title="${escapeHtml(row.name)}">${label}</a>`
                                : `<div class="schedule__label" title="${escapeHtml(row.name)}">${label}</div>`
                        }
                        <div class="schedule__track">${bars}</div>
                    </div>`;
                })
                .join('');
            return `
            <div class="schedule__row schedule__row--group schedule__row--${kind}">
                <div class="schedule__label">${tHtml(labelKey)}</div>
                <div class="schedule__track"></div>
            </div>
            ${rowsHtml}`;
        })
        .join('');

    const currentWeek = (weekStart(today) - from) / total;
    body.innerHTML = `
        <div class="schedule__legend">
            <span><i class="schedule__swatch"></i>${tHtml('calendar.schedule.recorded')}</span>
            <span><i class="schedule__swatch schedule__swatch--forecast"></i>${tHtml('calendar.schedule.forecast')}</span>
            <span><i class="schedule__swatch schedule__swatch--forecast schedule__swatch--guess"></i>${tHtml('calendar.schedule.forecastGuess')}</span>
            <span><i class="schedule__swatch schedule__swatch--past"></i>${tHtml('calendar.schedule.past')}</span>
            <span><i class="schedule__swatch schedule__swatch--today"></i>${tHtml('calendar.schedule.today')}</span>
        </div>
        <div class="schedule__scroll">
            <div class="schedule__chart" style="--columns: ${WEEKS}; --week-start: ${currentWeek}; --week-width: ${7 / total}; --today: ${(today - from + now.fraction) / total}">
                <div class="schedule__row schedule__row--axis">
                    <div class="schedule__label"></div>
                    <div class="schedule__track schedule__weeks">${weeks}</div>
                </div>
                ${groups}
                ${gridHtml(total, 7)}
                <div class="schedule__current-week" aria-hidden="true"></div>
                <div class="schedule__today" aria-hidden="true"></div>
            </div>
        </div>`;
    enableInfoTooltips(body);
}

export { barHtml, gridHtml, renderSchedule };
