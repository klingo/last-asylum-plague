/**
 * The Kingdom War box (`kingdom_war` in events.json, `core/kingdom-war.js`): which war week is on now, and the Royal
 * City Scramble of every Saturday. A chart over the current local week and the 4 after it (a whole cycle and the
 * restart): a row per war week (the break is the gap between Week 3 and the next Week 1) and one for the scramble. A
 * war week's bar starts and ends at the game's daily reset in local time; the scramble, 4 hours next to 6-day weeks,
 * is a faint bar for its day (it has the hover card) with its exact hours as a thin bar on top.
 */
import { localizedName, t, tHtml } from '../../ui/i18n.js';
import { escapeHtml } from '../../ui/html.js';
import { formatClock, formatDayCount, formatDaySpan, formatMoment, formatRunRange } from '../../ui/datetime.js';
import { countdownText, eventImageUrl, runStatusText, thumbHtml } from '../../ui/event-banner.js';
import { enableInfoTooltips } from '../../ui/tooltip.js';
import {
    barHtml,
    chartAttrs,
    columnsStyle,
    gridHtml,
    localDayBoundaries,
    localWeekStart,
    viewOf,
    weekHeadersHtml,
} from '../../ui/timeline.js';
import { dayStartMs, gameDay, runMoments, runStatus } from '../../core/schedule.js';
import { scrambleSlots, scrambleStatus, warPeriods, warStatus } from '../../core/kingdom-war.js';
import { ctx } from './state.js';
import { KINGDOM_WAR_WEEKS } from './constants.js';

/** "Now · Week 3: Finals, ends Sun, Nov 15, 03:00" (the break: when the next week starts; a day off: the same). */
function nowText(war, today) {
    const { current, next } = warStatus(war, today);
    if (current?.kind === 'week') {
        return t('calendar.kingdomWar.now', {
            week: localizedName(current.week.name),
            time: formatMoment(runMoments(current).end),
        });
    }
    if (!next) {
        return '';
    }
    return t(current ? 'calendar.kingdomWar.nowBreak' : 'calendar.kingdomWar.nowOff', {
        next: localizedName(next.week.name),
        time: formatMoment(runMoments(next).start),
    });
}

/** The scramble's line: on now (until when) or the next one in local time. */
function scrambleText(war, name, nowMs) {
    const { current, next } = scrambleStatus(war, nowMs);
    if (current) {
        return t('calendar.kingdomWar.scrambleNow', { name, time: formatClock(current.end) });
    }
    return next ? t('calendar.kingdomWar.scrambleNext', { name, range: formatRunRange(next.start, next.end) }) : '';
}

/**
 * A row of the chart: its name with art, and a bar for each item
 * `{ bar, tooltip (null: decoration only), label?, className? }`.
 */
function rowHtml(row, view) {
    const bars = row.items
        .map(({ bar, tooltip, label, className }) =>
            barHtml(bar, view, tooltip, { image: row.image, label, className }),
        )
        .join('');
    return `
        <div class="schedule__row schedule__row--${row.kind}">
            <div class="schedule__label" title="${escapeHtml(row.name)}">${thumbHtml(row.image)}${escapeHtml(row.name)}</div>
            <div class="schedule__track">${bars}</div>
        </div>`;
}

/**
 * The Kingdom War: the lead, where the war stands now (its week or break, with when it ends), the scramble and the
 * chart. Drawn again when a period or a scramble starts or ends (`refreshAt`).
 */
function renderKingdomWar() {
    const container = document.getElementById('kingdom-war');
    const data = ctx.packData;
    const war = data?.kingdom_war;
    if (!container || !war) {
        return;
    }
    const nowMs = Date.now();
    const today = gameDay(new Date(nowMs)).day;
    const boundaries = localDayBoundaries(localWeekStart(nowMs), KINGDOM_WAR_WEEKS * 7);
    const view = viewOf(boundaries);
    const periods = warPeriods(war, gameDay(new Date(view.from)).day, gameDay(new Date(view.to - 1)).day);
    const slots = scrambleSlots(war, view.from, view.to);
    const warEvent = data.events[war.event_id];
    const scrambleEvent = data.events[war.royal_city_scramble.event_id];
    const warName = localizedName(warEvent.name);
    const scrambleName = localizedName(scrambleEvent.name);
    const warImage = eventImageUrl(warEvent.image);
    const scrambleImage = eventImageUrl(scrambleEvent.image);

    // A war week's bar (its game days from the daily reset, its name on it) and the scramble's, with their hover cards.
    const periodItem = (period) => {
        const run = { start: period.start, end: period.end };
        const { start, end } = runMoments(run);
        const name = localizedName(period.week.name);
        return {
            bar: { start, end, past: end <= nowMs, active: start <= nowMs && nowMs < end },
            label: name,
            tooltip: [
                `${name}\t(${formatDayCount(run)})`,
                formatDaySpan(start, end),
                runStatusText(runStatus([run], today)),
            ].join('\n'),
        };
    };
    // The scramble: its day as a faint bar with the hover card, its hours as a thin bar on top (decoration only).
    const slotItems = (slot) => {
        const bar = { ...slot, past: slot.end <= nowMs, active: slot.start <= nowMs && nowMs < slot.end };
        const day = gameDay(new Date(slot.start)).day;
        const tooltip = [
            scrambleName,
            formatRunRange(slot.start, slot.end),
            ...(nowMs < slot.end
                ? [
                      countdownText(
                          nowMs < slot.start ? 'upcoming' : 'running',
                          nowMs < slot.start ? slot.start : slot.end,
                          nowMs,
                      ),
                  ]
                : []),
        ].join('\n');
        return [
            {
                bar: { ...bar, start: dayStartMs(day), end: dayStartMs(day + 1) },
                tooltip,
                className: 'schedule__bar--day',
            },
            { bar, tooltip: null, className: 'schedule__bar--hours' },
        ];
    };
    const rows = [
        ...war.weeks.filter(Boolean).map((week) => ({
            kind: 'ingame',
            name: localizedName(week.name),
            image: warImage,
            items: periods.filter((period) => period.kind === 'week' && period.week.id === week.id).map(periodItem),
        })),
        { kind: 'scramble', name: scrambleName, image: scrambleImage, items: slots.flatMap(slotItems) },
    ];
    // The chart is drawn again at the next moment anything on it starts or ends.
    const refreshAt = Math.min(
        Infinity,
        ...rows.flatMap((row) => row.items.flatMap(({ bar }) => [bar.start, bar.end])).filter((ms) => ms > nowMs),
    );

    container.innerHTML = `
        <section class="card schedule schedule--kingdom-war">
            <h2>${escapeHtml(warName)}</h2>
            <p class="text-dim">${tHtml('calendar.kingdomWar.lead', { scramble: escapeHtml(scrambleName) })}</p>
            <div class="schedule__body">
                <div class="schedule__legend">
                    <span><i class="schedule__swatch schedule__swatch--today"></i>${escapeHtml(nowText(war, today))}</span>
                    <span><i class="schedule__swatch schedule__swatch--active"></i>${escapeHtml(scrambleText(war, scrambleName, nowMs))}</span>
                </div>
                <div class="schedule__scroll">
                    <div class="schedule__chart" ${chartAttrs(boundaries, 7, nowMs, refreshAt)}>
                        <div class="schedule__row schedule__row--axis">
                            <div class="schedule__label"></div>
                            <div class="schedule__track schedule__weeks" style="${columnsStyle(boundaries, 7)}">${weekHeadersHtml(boundaries, KINGDOM_WAR_WEEKS)}</div>
                        </div>
                        ${rows.map((row) => rowHtml(row, view)).join('')}
                        ${gridHtml(boundaries, 7)}
                        <div class="schedule__current-week" aria-hidden="true"></div>
                        <div class="schedule__today" aria-hidden="true"></div>
                    </div>
                </div>
            </div>
        </section>`;
    enableInfoTooltips(container);
}

export { renderKingdomWar };
