import { startPage } from '../ui/page.js';
import { formatDays, getLocale, localizedName, t } from '../ui/i18n.js';
import { formatThousands } from '../ui/format.js';
import { buildValuation } from '../ui/valuation.js';
import { withLoading } from '../ui/loading.js';
import { ratioColor } from '../ui/ratio-bar.js';
import { escapeHtml } from '../ui/html.js';
import { enableInfoTooltips } from '../ui/tooltip.js';
import { createItemImage } from '../ui/images.js';
import { getSettings } from '../ui/settings.js';
import { packageIcon } from '../ui/labels.js';
import {
    eventImageUrl,
    runStatusText,
    scheduleHref,
    scheduleImage,
    scheduleName,
    slotRangeText,
} from '../ui/event-banner.js';
import { packageFamilyId } from '../core/pack-data.js';
import {
    GAME_DAY_START_MS,
    dayDate,
    forecastRuns,
    gameDay,
    isoWeekNumber,
    rotationSlots,
    rotationWindow,
    runStatus,
    scheduleRuns,
    weekdayIndex,
    weekdayRuns,
} from '../core/schedule.js';

// The schedule timeline: the current week and the 4 weeks ahead (Monday to Sunday).
const WEEKS = 5;
const GROUPS = [
    ['event', 'calendar.schedule.groupEvents'],
    ['ingame', 'calendar.schedule.groupIngame'],
    ['pass', 'calendar.schedule.groupPasses'],
    ['track', 'calendar.schedule.groupTracks'],
];

// Weekday offers (and the event rotations): today and the next 6 days (game days: they start at 02:00 UTC).
const ROTATION_DAYS = 7;
const HOUR_MS = 3600000;

let packData = null;
// The worth model (valuation.js): the weekday offers' bars are coloured by their ratio, as on the Pack Ranking.
let valuation = null;
// The game day both charts start from (the "Now" line moves within it; a new one redraws them).
let rotationDay = null;
// The Event Schedule's window (first day, number of days), for moving its "Now" line every minute.
let scheduleWindow = null;

function formatDay(day, options) {
    return dayDate(day).toLocaleDateString(getLocale(), { timeZone: 'UTC', ...options });
}

/** "Mon, 12 Oct – Tue, 13 Oct (2 days)" */
function rangeText(start, end) {
    const options = { weekday: 'short', day: 'numeric', month: 'short' };
    const days = end - start + 1;
    const range =
        start === end ? formatDay(start, options) : `${formatDay(start, options)} – ${formatDay(end, options)}`;
    return `${range} (${days === 1 ? t('calendar.schedule.oneDay') : t('calendar.schedule.days', { count: days })})`;
}

/**
 * A bar's hover card: "Strange Bazaar", the event's own line if it has one (`description`, e.g. its bonus),
 * "Mon, 12 Oct – Sun, 18 Oct (7 days)", "Ends in 3 days" (forecasts with their basis), and "Click to open its plan"
 * when it links to one.
 */
function scheduleTooltip(bar, row, today) {
    const lines = [
        row.name,
        ...(row.description ? [row.description] : []),
        rangeText(bar.start, bar.end),
        bar.missed ? t('calendar.status.notRecorded') : runStatusText(runStatus([bar], today)),
    ];
    if (bar.forecast) {
        const last = rangeText(bar.last.start, bar.last.end);
        // A weekday pattern ("every 7 days (Tue, Thu)"), else the usual gap ("about every 28 days").
        lines.push(
            bar.pattern
                ? t('calendar.schedule.forecastPattern', {
                      days: bar.pattern.days,
                      weekdays: formatDays(bar.pattern.weekdays),
                      last,
                  })
                : t('calendar.schedule.forecastBasis', { interval: bar.intervalDays, last }),
        );
        if (!bar.proven) {
            lines.push(t('calendar.schedule.guessNote', { count: bar.runCount }));
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
        bar.missed ? 'schedule__bar--missed' : '',
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
    if (!section || !packData) {
        return;
    }
    // Today is the game day (it starts at 02:00 UTC), as in the weekday offers.
    const now = gameDay(new Date());
    const today = now.day;
    const from = today - weekdayIndex(today);
    const to = from + WEEKS * 7 - 1;
    const total = to - from + 1;
    scheduleWindow = { from, total };

    const rows = [];
    for (const [id, { kind, runs }] of scheduleRuns(packData)) {
        const bars = [
            // Runs that ended before today are greyed out.
            ...runs.map((run) => ({ ...run, past: run.end < today })),
            ...forecastRuns(runs, { from, to, today }).map((run) => ({ ...run, forecast: true })),
        ].filter((bar) => bar.end >= from && bar.start <= to);
        if (bars.length > 0) {
            rows.push({
                kind,
                name: scheduleName(packData, id),
                description: localizedName(packData.events?.[id]?.description) || null,
                bars,
                first: bars[0].start,
                image: eventImageUrl(scheduleImage(packData, id)),
                href: scheduleHref(packData, id, getSettings().activeEvents),
            });
        }
    }

    const body = section.querySelector('.schedule__body');
    section.hidden = false;
    if (rows.length === 0) {
        body.innerHTML = `<p class="text-dim">${escapeHtml(t('calendar.schedule.empty'))}</p>`;
        return;
    }

    const weeks = Array.from({ length: WEEKS }, (_, index) => from + index * 7)
        .map(
            (monday) => `
                <div class="schedule__week${monday <= today && today < monday + 7 ? ' schedule__week--current' : ''}">
                    <strong>${escapeHtml(t('calendar.schedule.week', { week: isoWeekNumber(monday) }))}</strong>
                    <span>${escapeHtml(formatDay(monday, { day: 'numeric', month: 'short' }))}</span>
                </div>`,
        )
        .join('');
    const groups = GROUPS.map(([kind, labelKey]) => {
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
                <div class="schedule__label">${escapeHtml(t(labelKey))}</div>
                <div class="schedule__track"></div>
            </div>
            ${rowsHtml}`;
    }).join('');

    const currentWeek = (today - weekdayIndex(today) - from) / total;
    body.innerHTML = `
        <div class="schedule__legend">
            <span><i class="schedule__swatch"></i>${escapeHtml(t('calendar.schedule.recorded'))}</span>
            <span><i class="schedule__swatch schedule__swatch--forecast"></i>${escapeHtml(t('calendar.schedule.forecast'))}</span>
            <span><i class="schedule__swatch schedule__swatch--forecast schedule__swatch--guess"></i>${escapeHtml(t('calendar.schedule.forecastGuess'))}</span>
            <span><i class="schedule__swatch schedule__swatch--missed"></i>${escapeHtml(t('calendar.schedule.missed'))}</span>
            <span><i class="schedule__swatch schedule__swatch--past"></i>${escapeHtml(t('calendar.schedule.past'))}</span>
            <span><i class="schedule__swatch schedule__swatch--today"></i>${escapeHtml(t('calendar.schedule.today'))}</span>
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

/** "5h 12m", "42m": how long until a moment (whole minutes; the chart updates once a minute). */
function untilText(ms) {
    const minutes = Math.max(0, Math.floor(ms / 60000));
    return minutes >= 60
        ? t('calendar.rotation.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
        : t('calendar.rotation.minutes', { minutes });
}

/** "Now · today's offers end in 5h 12m (a new game day starts at 04:00)": the game day `day` ends at the next reset. */
function nowText(day) {
    const nextReset = dayDate(day + 1).getTime() + GAME_DAY_START_MS;
    const time = new Date(nextReset).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
    return t('calendar.rotation.now', { left: untilText(nextReset - Date.now()), time });
}

/**
 * One line on what's worth it: the offers with a ratio of 1.0 or more (best first, with their weekdays), or, if none
 * is, that none is and which comes closest. Empty without ratios.
 */
function rotationSummary(rows) {
    const ranked = rows.filter((row) => row.ratio !== null).sort((a, b) => b.ratio - a.ratio);
    if (ranked.length === 0) {
        return '';
    }
    const worthIt = ranked.filter((row) => row.ratio >= 1);
    return worthIt.length > 0
        ? t('calendar.rotation.worthIt', {
              offers: worthIt.map((row) => `${row.name} (${formatDays(row.days)})`).join(', '),
          })
        : t('calendar.rotation.noneWorthIt', { name: ranked[0].name, ratio: formatThousands(ranked[0].ratio, 2) });
}

/** The weekday columns of a day chart: "Today", "Tomorrow", then the weekday, each with its date; `from` = first game day. */
function dayHeadersHtml(from) {
    return Array.from({ length: ROTATION_DAYS }, (_, index) => from + index)
        .map((day, index) => {
            const label =
                index < 2
                    ? t(index === 0 ? 'calendar.rotation.today' : 'calendar.rotation.tomorrow')
                    : formatDay(day, { weekday: 'short' });
            return `
                <div class="schedule__week${index === 0 ? ' schedule__week--current' : ''}">
                    <strong>${escapeHtml(label)}</strong>
                    <span>${escapeHtml(formatDay(day, { day: 'numeric', month: 'short' }))}</span>
                </div>`;
        })
        .join('');
}

/** The local midnights that bound today and the next 6 days (a day is 23 or 25 hours long where the clocks change). */
function localDayBoundaries(nowMs) {
    const today = new Date(nowMs);
    return Array.from({ length: ROTATION_DAYS + 1 }, (_, index) =>
        new Date(today.getFullYear(), today.getMonth(), today.getDate() + index).getTime(),
    );
}

/** The day columns of a chart in the user's local days: "Today", "Tomorrow", then the weekday, each with its date. */
function localDayHeadersHtml(boundaries) {
    const locale = getLocale();
    return boundaries
        .slice(0, ROTATION_DAYS)
        .map((ms, index) => {
            const date = new Date(ms);
            const label =
                index < 2
                    ? t(index === 0 ? 'calendar.rotation.today' : 'calendar.rotation.tomorrow')
                    : date.toLocaleDateString(locale, { weekday: 'short' });
            return `
                <div class="schedule__week${index === 0 ? ' schedule__week--current' : ''}">
                    <strong>${escapeHtml(label)}</strong>
                    <span>${escapeHtml(date.toLocaleDateString(locale, { day: 'numeric', month: 'short' }))}</span>
                </div>`;
        })
        .join('');
}

/** "03" (or "08:30" where the time zone is off the full hour): a moment's local time, short. */
function hourLabel(ms) {
    const date = new Date(ms);
    const hours = String(date.getHours()).padStart(2, '0');
    return date.getMinutes() === 0 ? hours : `${hours}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** One slot's hover card: the phase and its times in local time. */
function slotTooltip(slot) {
    return [localizedName(slot.phase.name), slotRangeText(slot.start, slot.end)].join('\n');
}

/**
 * Event rotations (Survival Battle): a chart each, in the user's local time: today and the next 6 local days as
 * columns (midnight to midnight), one row per phase with a bar for each of its slots at the time it starts (so one can
 * run over midnight, e.g. 23:00 to 03:00; the ones already over grey), the day's own time slots (04:00, 08:00, ...) as
 * hours above the rows with a faint line each, and a line for the phase on now.
 */
function renderEventRotations() {
    const container = document.getElementById('event-rotations');
    if (!container || !packData) {
        return;
    }
    const nowMs = Date.now();
    const boundaries = localDayBoundaries(nowMs);
    const from = boundaries[0];
    const to = boundaries[ROTATION_DAYS];
    const percent = (ms) => ((ms - from) / (to - from)) * 100;
    container.innerHTML = Object.values(packData.event_rotations || {})
        .map((rotation) => {
            const slots = rotationWindow(rotation, from, to);
            const { current, next } = rotationSlots(rotation, nowMs);
            const rowsHtml = rotation.phases
                .map((phase) => {
                    const name = localizedName(phase.name);
                    const bars = slots
                        .filter((slot) => slot.phaseId === phase.id)
                        .map((slot) =>
                            // As the day chart's bars take them: counted in "days" of the window (a seventh of it, with fractions).
                            barHtml(
                                {
                                    start: ((slot.start - from) / (to - from)) * ROTATION_DAYS,
                                    end: ((slot.end - from) / (to - from)) * ROTATION_DAYS - 1,
                                    past: slot.end <= nowMs,
                                    active: slot.start <= nowMs && nowMs < slot.end,
                                },
                                0,
                                ROTATION_DAYS - 1,
                                slotTooltip(slot),
                            ),
                        );
                    return `
                        <div class="schedule__row schedule__row--ingame">
                            <div class="schedule__label" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                            <div class="schedule__track">${bars.join('')}</div>
                        </div>`;
                })
                .join('');
            // The day's own time slots as faint lines with the local hour above them (00:00 is the day's line): every
            // `hours` from local midnight (04:00, 08:00, 12:00, ...) where they divide the day, else the slots' boundaries.
            const ticks =
                24 % rotation.hours === 0
                    ? boundaries.slice(0, ROTATION_DAYS).flatMap((midnight) => {
                          const day = new Date(midnight);
                          return Array.from({ length: 24 / rotation.hours - 1 }, (_, index) =>
                              new Date(
                                  day.getFullYear(),
                                  day.getMonth(),
                                  day.getDate(),
                                  (index + 1) * rotation.hours,
                              ).getTime(),
                          );
                      })
                    : [...new Set(slots.flatMap((slot) => [slot.start, slot.end]))]
                          .filter((ms) => ms > from && ms < to)
                          .sort((a, b) => a - b);
            const hours = ticks.map(
                (ms) => `<span class="schedule__hour" style="left: ${percent(ms)}%">${hourLabel(ms)}</span>`,
            );
            const lines = [
                ...ticks.map((ms) => `<i style="left: ${percent(ms)}%"></i>`),
                ...boundaries
                    .slice(0, ROTATION_DAYS)
                    .map((ms) => `<i class="schedule__grid-major" style="left: ${percent(ms)}%"></i>`),
            ];
            const columns = boundaries
                .slice(0, ROTATION_DAYS)
                .map((ms, index) => `${(boundaries[index + 1] - ms) / HOUR_MS}fr`)
                .join(' ');
            const until = new Date(current.end).toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' });
            const nowLine = t('calendar.eventRotation.now', {
                current: localizedName(current.phase.name),
                time: until,
                next: localizedName(next.phase.name),
            });
            // `data-refresh-at`: when the phase on now ends or the local day changes, the chart is drawn again.
            return `
                <section class="card schedule schedule--event-rotation" data-from="${from}" data-to="${to}" data-refresh-at="${Math.min(current.end, boundaries[1])}">
                    <h2>${escapeHtml(localizedName(packData.events[rotation.event_id].name))}</h2>
                    <p class="text-dim">${escapeHtml(t('calendar.eventRotation.lead'))}</p>
                    <div class="schedule__body">
                        <div class="schedule__legend">
                            <span><i class="schedule__swatch schedule__swatch--today"></i>${escapeHtml(nowLine)}</span>
                            <span><i class="schedule__swatch schedule__swatch--active"></i>${escapeHtml(t('calendar.eventRotation.active'))}</span>
                            <span><i class="schedule__swatch schedule__swatch--upcoming"></i>${escapeHtml(t('calendar.eventRotation.upcoming'))}</span>
                            <span><i class="schedule__swatch schedule__swatch--past"></i>${escapeHtml(t('calendar.schedule.past'))}</span>
                        </div>
                        <div class="schedule__scroll">
                            <div class="schedule__chart schedule__chart--days" style="--columns: ${ROTATION_DAYS}; --week-start: 0; --week-width: ${(boundaries[1] - boundaries[0]) / (to - from)}; --today: ${(nowMs - from) / (to - from)}">
                                <div class="schedule__row schedule__row--axis">
                                    <div class="schedule__label"></div>
                                    <div class="schedule__track schedule__weeks" style="grid-template-columns: ${columns}">${localDayHeadersHtml(boundaries)}</div>
                                </div>
                                ${hours.length > 0 ? `<div class="schedule__row schedule__row--hours" aria-hidden="true"><div class="schedule__label"></div><div class="schedule__track">${hours.join('')}</div></div>` : ''}
                                ${rowsHtml}
                                <div class="schedule__grid" aria-hidden="true">${lines.join('')}</div>
                                <div class="schedule__current-week" aria-hidden="true"></div>
                                <div class="schedule__today" aria-hidden="true"></div>
                            </div>
                        </div>
                    </div>
                </section>`;
        })
        .join('');
    enableInfoTooltips(container);
}

/** When a weekday offer's bar (whole game days `start`..`end`) is on sale, in the user's time: "Thu 03:00 AM". */
function saleWindowText(bar) {
    const at = (day) =>
        new Date(dayDate(day).getTime() + GAME_DAY_START_MS).toLocaleString(getLocale(), {
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    return t('calendar.rotation.onSale', { from: at(bar.start), to: at(bar.end + 1) });
}

/**
 * Weekday offers (`weekly_rotation` packs): today and the next 6 game days, one row per pack family, with a line
 * for now (and how long today's offers last) and a line on which are worth it.
 */
function renderRotation() {
    const section = document.getElementById('rotation');
    if (!section || !packData) {
        return;
    }
    const now = gameDay(new Date());
    const from = now.day;
    const to = from + ROTATION_DAYS - 1;
    rotationDay = from;
    const families = new Map();
    for (const [id, pkg] of Object.entries(packData.packages || {})) {
        if (pkg.category !== 'weekly_rotation') {
            continue;
        }
        const familyId = packageFamilyId(id, pkg);
        // The family's best ratio over its tiers (the Pack Ranking's number), if all its contents have a worth.
        const ratio = valuation.bundle(pkg, pkg.price).ratio;
        const entry = families.get(familyId) || { pkg, ratio: null };
        if (Number.isFinite(ratio) && !(entry.ratio >= ratio)) {
            entry.ratio = ratio;
        }
        families.set(familyId, entry);
    }
    const rows = [...families.values()]
        .map(({ pkg, ratio }) => {
            const name = localizedName(pkg.name);
            const tooltip = [
                name,
                t('calendar.rotation.every', { days: formatDays(pkg.available_days) }),
                ratio === null ? '' : `${t('rankings.table.ratio')}: ${formatThousands(ratio, 2)}`,
            ]
                .filter(Boolean)
                .join('\n');
            return {
                name,
                tooltip,
                ratio,
                days: pkg.available_days,
                icon: packageIcon(pkg),
                bars: weekdayRuns(pkg.available_days, from, to),
            };
        })
        .filter((row) => row.bars.length > 0)
        .sort((a, b) => a.bars[0].start - b.bars[0].start || a.name.localeCompare(b.name));
    if (rows.length === 0) {
        section.hidden = true;
        return;
    }
    // The Pack Ranking's ratio colours (fixed scale around 1.0: red up to 0.85, amber at 1.0, green from 1.15).
    for (const row of rows) {
        row.color = row.ratio === null ? null : ratioColor(row.ratio);
    }

    const days = dayHeadersHtml(from);
    const rowsHtml = rows
        .map(
            (row) => `
                <div class="schedule__row schedule__row--rotation">
                    <div class="schedule__label" title="${escapeHtml(row.name)}" data-icon="${escapeHtml(row.icon || '')}">${escapeHtml(row.name)}</div>
                    <div class="schedule__track">${row.bars.map((bar) => barHtml(bar, from, to, `${row.tooltip}\n${saleWindowText(bar)}`, { color: row.color })).join('')}</div>
                </div>`,
        )
        .join('');
    const summary = rotationSummary(rows);
    section.hidden = false;
    section.querySelector('.schedule__body').innerHTML = `
        <div class="schedule__legend">
            <span><i class="schedule__swatch schedule__swatch--today"></i><span class="schedule__now-text">${escapeHtml(nowText(from))}</span></span>
            <span>${escapeHtml(t('calendar.rotation.colour'))}</span>
        </div>
        <div class="schedule__scroll">
            <div class="schedule__chart schedule__chart--days" style="--columns: ${ROTATION_DAYS}; --week-start: 0; --week-width: ${1 / ROTATION_DAYS}; --today: ${now.fraction / ROTATION_DAYS}">
                <div class="schedule__row schedule__row--axis">
                    <div class="schedule__label"></div>
                    <div class="schedule__track schedule__weeks">${days}</div>
                </div>
                ${rowsHtml}
                ${gridHtml(ROTATION_DAYS, 1)}
                <div class="schedule__current-week" aria-hidden="true"></div>
                <div class="schedule__today" aria-hidden="true"></div>
            </div>
        </div>
        ${summary ? `<p class="schedule__summary">${escapeHtml(summary)}</p>` : ''}`;
    // Icons via createItemImage (placeholder if the image is missing, item name as mouse-over).
    for (const label of section.querySelectorAll('.schedule__label[data-icon]')) {
        const itemId = label.dataset.icon;
        if (itemId) {
            label.prepend(
                createItemImage(itemId, localizedName(packData.items?.[itemId]?.name), 'item-icon schedule__icon'),
            );
        }
    }
    enableInfoTooltips(section);
}

function render() {
    renderSchedule();
    renderRotation();
    renderEventRotations();
}

/**
 * Every minute: the charts' "Now" lines move on; when a new game day starts, the charts move on to it, and a
 * Survival Battle chart is drawn again when the phase on now ends.
 */
function tickRotation() {
    const now = gameDay(new Date());
    if (now.day !== rotationDay) {
        render();
        return;
    }
    document
        .querySelector('#rotation .schedule__chart')
        ?.style.setProperty('--today', String(now.fraction / ROTATION_DAYS));
    if (scheduleWindow) {
        document
            .querySelector('#schedule .schedule__chart')
            ?.style.setProperty(
                '--today',
                String((now.day - scheduleWindow.from + now.fraction) / scheduleWindow.total),
            );
    }
    const nowLabel = document.querySelector('#rotation .schedule__now-text');
    if (nowLabel) {
        nowLabel.textContent = nowText(now.day);
    }
    const nowMs = Date.now();
    for (const section of document.querySelectorAll('.schedule--event-rotation')) {
        if (nowMs >= Number(section.dataset.refreshAt)) {
            renderEventRotations();
            break;
        }
        section
            .querySelector('.schedule__chart')
            ?.style.setProperty(
                '--today',
                String(
                    (nowMs - Number(section.dataset.from)) /
                        (Number(section.dataset.to) - Number(section.dataset.from)),
                ),
            );
    }
}

startPage('calendar', {
    async init(data) {
        packData = data;
        await withLoading(async () => {
            valuation = await buildValuation(data, getSettings());
        });
        render();
        window.setInterval(tickRotation, 60000);
    },
    onLocaleChange: render,
});
