/**
 * The Event Schedule: one row per event, pass and track over the next weeks, with their forecasts.
 */
import { enumLabel, localizedName, t, tHtml } from '../../ui/i18n.js';
import { escapeHtml } from '../../ui/html.js';
import { formatDate, formatDayCount, formatDaySpan } from '../../ui/datetime.js';
import { enableInfoTooltips } from '../../ui/tooltip.js';
import { getSettings } from '../../ui/settings.js';
import { SCHEDULE_KIND_LABELS } from '../../ui/labels.js';
import {
    eventImageUrl,
    runStatusText,
    scheduleHref,
    scheduleImage,
    scheduleName,
    thumbHtml,
} from '../../ui/event-banner.js';
import {
    barHtml,
    chartAttrs,
    columnsStyle,
    gridHtml,
    localDayBoundaries,
    localDayNumber,
    localWeekStart,
    viewOf,
} from '../../ui/timeline.js';
import { gameDay, isoWeekNumber, runMoments, runStatus, scheduleBars } from '../../core/schedule.js';
import { ctx } from './state.js';
import { WEEKS } from './constants.js';

/**
 * A bar's hover card: "Strange Bazaar" with "(7 days)" right-aligned on its line (a tab splits the line, see
 * tooltip.js), the event's own line if it has one (`description`, e.g. its bonus), "Mon, Oct 12 – Mon, Oct 19 ·
 * 04:00 AM", "Ends in 3 days" (forecasts with their rhythm). A bar that links to the plan adds "Open its plan" to the
 * card itself (`barHtml`'s `action`), a button on a phone.
 */
function scheduleTooltip(bar, row, today) {
    const { start, end } = runMoments(bar);
    const lines = [
        `${row.name}\t(${formatDayCount(bar)})`,
        ...(row.description ? [row.description] : []),
        formatDaySpan(start, end),
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
                    weekdays: bar.pattern.weekdays.map((day) => enumLabel('weekdayShort', day)).join(', '),
                }),
            );
        } else {
            lines.push(t('calendar.schedule.forecastBasis', { interval: bar.intervalDays }));
        }
    }
    return lines.join('\n');
}

/**
 * The weeks from the local Monday of this week, on local days. The runs themselves are game days (they start and end
 * at the 02:00 UTC reset), so the bars come from the game days the view touches and sit at their moments.
 */
function renderSchedule() {
    const section = document.getElementById('schedule');
    if (!section || !ctx.packData) {
        return;
    }
    const nowMs = Date.now();
    const today = gameDay(new Date(nowMs)).day;
    const boundaries = localDayBoundaries(localWeekStart(nowMs), WEEKS * 7);
    const view = viewOf(boundaries);
    const firstDay = gameDay(new Date(view.from)).day;
    const lastDay = gameDay(new Date(view.to - 1)).day;

    const rows = scheduleBars(ctx.packData, today, firstDay, lastDay).map(({ id, kind, bars }) => ({
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

    const weeks = Array.from({ length: WEEKS }, (_, index) => boundaries[index * 7])
        .map(
            (monday, index) => `
                <div class="schedule__week${index === 0 ? ' schedule__week--current' : ''}">
                    <strong>${tHtml('calendar.schedule.week', { week: isoWeekNumber(localDayNumber(monday)) })}</strong>
                    <span>${escapeHtml(formatDate(monday, { day: 'numeric', month: 'short' }))}</span>
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
                            barHtml({ ...bar, ...runMoments(bar) }, view, scheduleTooltip(bar, row, today), {
                                href: row.href,
                                action: t('calendar.status.openPlan'),
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

    body.innerHTML = `
        <div class="schedule__legend">
            <span><i class="schedule__swatch"></i>${tHtml('calendar.schedule.recorded')}</span>
            <span><i class="schedule__swatch schedule__swatch--forecast"></i>${tHtml('calendar.schedule.forecast')}</span>
            <span><i class="schedule__swatch schedule__swatch--forecast schedule__swatch--guess"></i>${tHtml('calendar.schedule.forecastGuess')}</span>
            <span><i class="schedule__swatch schedule__swatch--past"></i>${tHtml('calendar.schedule.past')}</span>
            <span><i class="schedule__swatch schedule__swatch--today"></i>${tHtml('calendar.schedule.today')}</span>
        </div>
        <div class="schedule__scroll">
            <div class="schedule__chart" ${chartAttrs(boundaries, 7, nowMs)}>
                <div class="schedule__row schedule__row--axis">
                    <div class="schedule__label"></div>
                    <div class="schedule__track schedule__weeks" style="${columnsStyle(boundaries, 7)}">${weeks}</div>
                </div>
                ${groups}
                ${gridHtml(boundaries, 7)}
                <div class="schedule__current-week" aria-hidden="true"></div>
                <div class="schedule__today" aria-hidden="true"></div>
            </div>
        </div>`;
    enableInfoTooltips(body);
}

export { renderSchedule };
