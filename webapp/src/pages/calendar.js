import { startPage } from '../ui/page.js';
import { formatDays, getLocale, localizedName, t } from '../ui/i18n.js';
import { escapeHtml } from '../ui/html.js';
import { enableInfoTooltips } from '../ui/tooltip.js';
import { createItemImage } from '../ui/images.js';
import { DEFAULT_NONE_ITEMS, getSettings } from '../ui/settings.js';
import { eventImageUrl, runStatusText, scheduleImage } from '../ui/event-banner.js';
import { packageFamilyId } from '../core/pack-data.js';
import {
    GAME_DAY_START_MS,
    dayDate,
    forecastRuns,
    gameDay,
    isoWeekNumber,
    runStatus,
    scheduleRuns,
    weekdayIndex,
    weekdayRuns,
} from '../core/schedule.js';

// The schedule timeline: last week, the current week and 4 weeks ahead (Monday to Sunday).
const WEEKS_BACK = 1;
const WEEKS = 6;
const GROUPS = [
    ['event', 'calendar.schedule.groupEvents'],
    ['ingame', 'calendar.schedule.groupIngame'],
    ['pass', 'calendar.schedule.groupPasses'],
    ['track', 'calendar.schedule.groupTracks'],
];

// Weekday offers: today and the next 6 days (game days: they start at 02:00 UTC).
const ROTATION_DAYS = 7;

let packData = null;
// The game day both charts start from (the "Now" line moves within it; a new one redraws them).
let rotationDay = null;

function scheduleName(data, id, kind) {
    if (kind === 'pass') {
        const entry = Object.entries(data.packages || {}).find(([pkgId, pkg]) => packageFamilyId(pkgId, pkg) === id);
        return entry ? localizedName(entry[1].name) : id;
    }
    // The "track" group also holds events with `calendar_group: "spend_rewards"`.
    const entry = data.events?.[id] || (kind === 'track' ? data.spend_reward_tracks?.[id] : null);
    return entry ? localizedName(entry.name) : id;
}

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
 * A bar's hover card: "Strange Bazaar", "Mon, 12 Oct – Sun, 18 Oct (7 days)", "Ends in 3 days" (forecasts with
 * their basis), and "Click to open its plan" when it links to one.
 */
function scheduleTooltip(bar, name, today, linked) {
    const lines = [name, rangeText(bar.start, bar.end), runStatusText(runStatus([bar], today))];
    if (bar.forecast) {
        lines.push(
            t('calendar.schedule.forecastBasis', {
                interval: bar.intervalDays,
                last: rangeText(bar.last.start, bar.last.end),
            }),
        );
    }
    if (linked) {
        lines.push(t('calendar.status.openPlan'));
    }
    return lines.join('\n');
}

/**
 * Where a schedule entry is planned: a ticked event on the Events page, a spend reward track on Spend Rewards
 * (passes and in-game events have no page of their own); null otherwise.
 */
function planHref(id) {
    if (packData.events?.[id]?.category !== 'ingame_event' && getSettings().activeEvents?.includes(id)) {
        return `events.html?event=${encodeURIComponent(`event:${id}`)}`;
    }
    return packData.spend_reward_tracks?.[id] ? `spend-rewards.html?track=${encodeURIComponent(id)}` : null;
}

/** A bar; with `href` a link (opens its plan), with `image` the hover card shows the art. */
function barHtml(bar, from, to, tooltip, { href = null, image = null } = {}) {
    const start = Math.max(bar.start, from);
    const end = Math.min(bar.end, to);
    const total = to - from + 1;
    const classes = [
        'schedule__bar',
        bar.forecast ? 'schedule__bar--forecast' : '',
        bar.past ? 'schedule__bar--past' : '',
        bar.start < from ? 'schedule__bar--cut-start' : '',
        bar.end > to ? 'schedule__bar--cut-end' : '',
    ].filter(Boolean);
    // A 1px inset on both ends (2px gap between bars on neighbouring days), none where the window cuts the bar.
    const insetStart = bar.start < from ? 0 : 1;
    const insetEnd = bar.end > to ? 0 : 1;
    const style = `left: calc(${((start - from) / total) * 100}% + ${insetStart}px); width: calc(${((end - start + 1) / total) * 100}% - ${insetStart + insetEnd}px)`;
    const tag = href ? 'a' : 'span';
    const linkAttrs = href ? ` href="${escapeHtml(href)}"` : ' tabindex="0" role="img"';
    const imageAttr = image ? ` data-tooltip-image="${escapeHtml(image)}"` : '';
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
    const today = gameDay(new Date()).day;
    const from = today - weekdayIndex(today) - WEEKS_BACK * 7;
    const to = from + WEEKS * 7 - 1;
    const total = to - from + 1;

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
                name: scheduleName(packData, id, kind),
                bars,
                first: bars[0].start,
                image: eventImageUrl(scheduleImage(packData, id)),
                href: planHref(id),
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
                        barHtml(bar, from, to, scheduleTooltip(bar, row.name, today, Boolean(row.href)), {
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
            <span><i class="schedule__swatch schedule__swatch--past"></i>${escapeHtml(t('calendar.schedule.past'))}</span>
            <span><i class="schedule__swatch schedule__swatch--today"></i>${escapeHtml(t('calendar.schedule.today'))}</span>
        </div>
        <div class="schedule__scroll">
            <div class="schedule__chart" style="--columns: ${WEEKS}; --week-start: ${currentWeek}; --week-width: ${7 / total}; --today: ${(today - from + 0.5) / total}">
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

// Items every pack gives on the side: never a pack's icon.
const FILLER_ITEMS = new Set(['diamonds', ...DEFAULT_NONE_ITEMS]);

/** The item whose image stands for a package: its `icon`, else its first item that isn't filler. */
function packageIcon(pkg) {
    return pkg.icon || Object.keys(pkg.contains || {}).find((itemId) => !FILLER_ITEMS.has(itemId)) || null;
}

/**
 * Weekday offers (`weekly_rotation` packs): today and the next 6 game days, one row per pack family, with a line
 * for now.
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
        const familyId = packageFamilyId(id, pkg);
        if (pkg.category === 'weekly_rotation' && !families.has(familyId)) {
            families.set(familyId, pkg);
        }
    }
    const rows = [...families.values()]
        .map((pkg) => {
            const name = localizedName(pkg.name);
            const tooltip = `${name}\n${t('calendar.rotation.every', { days: formatDays(pkg.available_days) })}`;
            return { name, tooltip, icon: packageIcon(pkg), bars: weekdayRuns(pkg.available_days, from, to) };
        })
        .filter((row) => row.bars.length > 0)
        .sort((a, b) => a.bars[0].start - b.bars[0].start || a.name.localeCompare(b.name));
    if (rows.length === 0) {
        section.hidden = true;
        return;
    }

    const days = Array.from({ length: ROTATION_DAYS }, (_, index) => from + index)
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
    const rowsHtml = rows
        .map(
            (row) => `
                <div class="schedule__row schedule__row--rotation">
                    <div class="schedule__label" title="${escapeHtml(row.name)}" data-icon="${escapeHtml(row.icon || '')}">${escapeHtml(row.name)}</div>
                    <div class="schedule__track">${row.bars.map((bar) => barHtml(bar, from, to, row.tooltip)).join('')}</div>
                </div>`,
        )
        .join('');
    // When the game day starts, in local time ("04:00" in CEST).
    const dayStart = new Date(dayDate(from).getTime() + GAME_DAY_START_MS).toLocaleTimeString(getLocale(), {
        hour: '2-digit',
        minute: '2-digit',
    });
    section.hidden = false;
    section.querySelector('.schedule__body').innerHTML = `
        <div class="schedule__legend">
            <span><i class="schedule__swatch schedule__swatch--today"></i>${escapeHtml(t('calendar.rotation.now', { time: dayStart }))}</span>
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
        </div>`;
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
}

/** Every minute: the "Now" line moves on; when a new game day starts, both charts move on to it. */
function tickRotation() {
    const now = gameDay(new Date());
    if (now.day !== rotationDay) {
        render();
        return;
    }
    document
        .querySelector('#rotation .schedule__chart')
        ?.style.setProperty('--today', String(now.fraction / ROTATION_DAYS));
}

startPage('calendar', {
    init(data) {
        packData = data;
        render();
        window.setInterval(tickRotation, 60000);
    },
    onLocaleChange: render,
});
