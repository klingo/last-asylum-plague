/**
 * The Kingdom War box (`kingdom_war` in events.json, `core/kingdom-war.js`): which war week is on now, the Royal City
 * Scramble of every Saturday and Origin of the Curse of the break week. A chart over the current local week and the 3
 * after it with three rows: the war weeks (one bar each, named, the break is the gap between Week 3 and the next
 * Week 1), the scramble and Origin of the Curse (its run in the break week). A war week's bar starts and ends at the
 * game's daily reset in local time; the scramble, 4 hours next to 6-day weeks, is a faint bar for its day (it has the
 * hover card) with its exact hours as a thin bar on top. Origin of the Curse is the same: its run as the faint bar,
 * its contests as the thin ones (the hover card names their start times). A thin bar is in the "on now" colour
 * with its faint one.
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
import {
    curseRuns,
    curseStatus,
    scrambleSlots,
    scrambleStatus,
    warPeriods,
    warStatus,
} from '../../core/kingdom-war.js';
import { ctx } from './state.js';
import { KINGDOM_WAR_WEEKS } from './constants.js';

// The phase of Origin of the Curse whose times the hover card names and the chart marks as a thin bar.
const CURSE_CONTEST_PHASE = 'contest';

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

/** Origin of the Curse's line: the phase on now (until when) or the next one, in local time. */
function curseText(war, name, nowMs) {
    const { current, next } = curseStatus(war, nowMs);
    if (current) {
        return t('calendar.kingdomWar.curseNow', {
            name,
            phase: localizedName(current.phase.name),
            time: formatMoment(current.end),
        });
    }
    return next
        ? t('calendar.kingdomWar.curseNext', {
              name,
              phase: localizedName(next.phase.name),
              time: formatMoment(next.start),
          })
        : '';
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
 * The Kingdom War: the lead, where the war stands now (its week or break, with when it ends), Origin of the Curse, the
 * scramble and the chart. Drawn again when a period or a scramble starts or ends (`refreshAt`).
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
    const curse = war.origin_of_the_curse;
    const curseRunList = curse ? curseRuns(war, view.from, view.to) : [];
    const warEvent = data.events[war.event_id];
    const scrambleEvent = data.events[war.royal_city_scramble.event_id];
    const curseEvent = curse ? data.events[curse.event_id] : null;
    const warName = localizedName(warEvent.name);
    const scrambleName = localizedName(scrambleEvent.name);
    const curseName = curseEvent ? localizedName(curseEvent.name) : '';
    const warImage = eventImageUrl(warEvent.image);
    const scrambleImage = eventImageUrl(scrambleEvent.image);
    const curseImage = eventImageUrl(curseEvent?.image);

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
    // "Starts in …" / "Ends in …" for what is not over yet.
    const countdownLines = (start, end) =>
        nowMs < end ? [countdownText(nowMs < start ? 'upcoming' : 'running', nowMs < start ? start : end, nowMs)] : [];
    // A faint bar for a whole game day (or run) with the hover card, and the exact hours (`hours`, a list of
    // `{ start, end }`) as thin bars on top (decoration only). While the day (run) is on, its thin bars are in the
    // "on now" colour too, so the two match.
    const dayAndHoursItems = ({ start, end }, tooltip, hours) => {
        const active = start <= nowMs && nowMs < end;
        return [
            { bar: { start, end, past: end <= nowMs, active }, tooltip, className: 'schedule__bar--day' },
            ...hours.map((slot) => ({
                bar: { start: slot.start, end: slot.end, past: slot.end <= nowMs, active },
                tooltip: null,
                className: 'schedule__bar--hours',
            })),
        ];
    };
    // The scramble: its day with the hover card, its hours on top.
    const slotItems = (slot) => {
        const day = gameDay(new Date(slot.start)).day;
        const tooltip = [scrambleName, formatRunRange(slot.start, slot.end), ...countdownLines(slot.start, slot.end)];
        return dayAndHoursItems({ start: dayStartMs(day), end: dayStartMs(day + 1) }, tooltip.join('\n'), [slot]);
    };
    // Origin of the Curse: its run with the hover card (the run's days, each contest's start), the contests on
    // top.
    const curseItems = (run) => {
        const contests = run.segments.filter(({ phase }) => phase.id === CURSE_CONTEST_PHASE);
        const tooltip = [
            curseName,
            formatDaySpan(run.start, run.end),
            ...contests.map(({ phase, start }) => `${localizedName(phase.name)}\t${formatMoment(start)}`),
            ...countdownLines(run.start, run.end),
        ].join('\n');
        return dayAndHoursItems(run, tooltip, contests);
    };
    const rows = [
        {
            kind: 'ingame',
            name: warName,
            image: warImage,
            items: periods.filter((period) => period.kind === 'week').map(periodItem),
        },
        { kind: 'scramble', name: scrambleName, image: scrambleImage, items: slots.flatMap(slotItems) },
        ...(curse
            ? [{ kind: 'curse', name: curseName, image: curseImage, items: curseRunList.flatMap(curseItems) }]
            : []),
    ];
    // The chart is drawn again at the next moment anything on it starts or ends (the legend's phase changes too).
    const refreshAt = Math.min(
        Infinity,
        ...[
            ...rows.flatMap((row) => row.items.flatMap(({ bar }) => [bar.start, bar.end])),
            ...curseRunList.flatMap((run) => run.segments.flatMap(({ start, end }) => [start, end])),
        ].filter((ms) => ms > nowMs),
    );

    container.innerHTML = `
        <section class="card schedule schedule--kingdom-war">
            <details data-section="${escapeHtml(war.event_id)}" open>
            <summary class="card-toggle"><h2>${escapeHtml(warName)}</h2></summary>
            <p class="text-dim">${tHtml('calendar.kingdomWar.lead', { scramble: escapeHtml(scrambleName) })}</p>
            <div class="schedule__body">
                <div class="schedule__legend">
                    <span><i class="schedule__swatch schedule__swatch--today"></i>${escapeHtml(nowText(war, today))}</span>
                    <span><i class="schedule__swatch schedule__swatch--active"></i>${escapeHtml(scrambleText(war, scrambleName, nowMs))}</span>
                    ${curse ? `<span><i class="schedule__swatch schedule__swatch--active"></i>${escapeHtml(curseText(war, curseName, nowMs))}</span>` : ''}
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
            </details>
        </section>`;
    enableInfoTooltips(container);
}

export { renderKingdomWar };
