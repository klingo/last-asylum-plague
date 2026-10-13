import './style.css';
import { renderNav } from './nav';
import { applyStaticTranslations, getLocale, localizedName, t } from './lib/i18n';
import { loadPackData } from './lib/data';
import { escapeHtml } from './lib/labels';
import { enableInfoTooltips } from './lib/tooltip';
import { packageFamilyId } from './lib/catalog.js';
import { dayDate, forecastRuns, isoWeekNumber, localDayNumber, scheduleRuns, weekdayIndex } from './lib/schedule.js';

renderNav('welcome');
applyStaticTranslations();

// The schedule timeline: last week, the current week and 4 weeks ahead (Monday to Sunday).
const WEEKS_BACK = 1;
const WEEKS = 6;
const GROUPS = [
    ['event', 'welcome.schedule.groupEvents'],
    ['ingame', 'welcome.schedule.groupIngame'],
    ['pass', 'welcome.schedule.groupPasses'],
    ['track', 'welcome.schedule.groupTracks'],
];

let packData = null;

function scheduleName(data, id, kind) {
    if (kind === 'pass') {
        const entry = Object.entries(data.packages || {}).find(([pkgId, pkg]) => packageFamilyId(pkgId, pkg) === id);
        return entry ? localizedName(entry[1].name) : id;
    }
    const lookup = kind === 'track' ? data.spend_reward_tracks : data.events;
    return lookup?.[id] ? localizedName(lookup[id].name) : id;
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
    return `${range} (${days === 1 ? t('welcome.schedule.oneDay') : t('welcome.schedule.days', { count: days })})`;
}

function barHtml(bar, from, to, name) {
    const start = Math.max(bar.start, from);
    const end = Math.min(bar.end, to);
    const total = to - from + 1;
    const tooltip = bar.forecast
        ? `${name} · ${rangeText(bar.start, bar.end)} · ${t('welcome.schedule.forecastBasis', {
              interval: bar.intervalDays,
              last: rangeText(bar.last.start, bar.last.end),
          })}`
        : `${name} · ${rangeText(bar.start, bar.end)}`;
    const classes = [
        'schedule__bar',
        bar.forecast ? 'schedule__bar--forecast' : '',
        bar.start < from ? 'schedule__bar--cut-start' : '',
        bar.end > to ? 'schedule__bar--cut-end' : '',
    ].filter(Boolean);
    // A 1px inset on both ends (2px gap between bars on neighbouring days), none where the window cuts the bar.
    const insetStart = bar.start < from ? 0 : 1;
    const insetEnd = bar.end > to ? 0 : 1;
    const style = `left: calc(${((start - from) / total) * 100}% + ${insetStart}px); width: calc(${((end - start + 1) / total) * 100}% - ${insetStart + insetEnd}px)`;
    return `<span class="${classes.join(' ')}" style="${style}" tabindex="0" role="img" aria-label="${escapeHtml(tooltip)}" data-tooltip="${escapeHtml(tooltip)}"></span>`;
}

function renderSchedule() {
    const section = document.getElementById('schedule');
    if (!section || !packData) {
        return;
    }
    const today = localDayNumber(new Date());
    const from = today - weekdayIndex(today) - WEEKS_BACK * 7;
    const to = from + WEEKS * 7 - 1;
    const total = to - from + 1;

    const rows = [];
    for (const [id, { kind, runs }] of scheduleRuns(packData)) {
        const bars = [
            ...runs,
            ...forecastRuns(runs, { from, to, today }).map((run) => ({ ...run, forecast: true })),
        ].filter((bar) => bar.end >= from && bar.start <= to);
        if (bars.length > 0) {
            rows.push({ kind, name: scheduleName(packData, id, kind), bars, first: bars[0].start });
        }
    }

    const body = section.querySelector('.schedule__body');
    section.hidden = false;
    if (rows.length === 0) {
        body.innerHTML = `<p class="text-dim">${escapeHtml(t('welcome.schedule.empty'))}</p>`;
        return;
    }

    const weeks = Array.from({ length: WEEKS }, (_, index) => from + index * 7)
        .map(
            (monday) => `
                <div class="schedule__week${monday <= today && today < monday + 7 ? ' schedule__week--current' : ''}">
                    <strong>${escapeHtml(t('welcome.schedule.week', { week: isoWeekNumber(monday) }))}</strong>
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
        const rowsHtml = groupRows
            .map(
                (row) => `
                    <div class="schedule__row schedule__row--${kind}">
                        <div class="schedule__label" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</div>
                        <div class="schedule__track">${row.bars.map((bar) => barHtml(bar, from, to, row.name)).join('')}</div>
                    </div>`,
            )
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
            <span><i class="schedule__swatch"></i>${escapeHtml(t('welcome.schedule.recorded'))}</span>
            <span><i class="schedule__swatch schedule__swatch--forecast"></i>${escapeHtml(t('welcome.schedule.forecast'))}</span>
            <span><i class="schedule__swatch schedule__swatch--today"></i>${escapeHtml(t('welcome.schedule.today'))}</span>
        </div>
        <div class="schedule__scroll">
            <div class="schedule__chart" style="--weeks: ${WEEKS}; --week-start: ${currentWeek}; --week-width: ${7 / total}; --today: ${(today - from + 0.5) / total}">
                <div class="schedule__row schedule__row--axis">
                    <div class="schedule__label"></div>
                    <div class="schedule__track schedule__weeks">${weeks}</div>
                </div>
                ${groups}
                <div class="schedule__current-week" aria-hidden="true"></div>
                <div class="schedule__today" aria-hidden="true"></div>
            </div>
        </div>`;
    enableInfoTooltips(body);
}

window.addEventListener('localechange', () => {
    applyStaticTranslations();
    renderSchedule();
});

// The schedule needs the data; the rest of the page works without it.
loadPackData()
    .then((data) => {
        packData = data;
        renderSchedule();
    })
    .catch(() => {});
