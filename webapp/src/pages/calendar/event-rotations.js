/**
 * The event rotations (Survival Battle): a chart of the slots of today and the next 6 days.
 */
import { localizedName, t, tHtml } from '../../ui/i18n.js';
import { escapeHtml } from '../../ui/html.js';
import { formatClock, formatRunRange, pad2 } from '../../ui/datetime.js';
import { enableInfoTooltips } from '../../ui/tooltip.js';
import {
    barHtml,
    chartAttrs,
    columnsStyle,
    dayHeadersHtml,
    gridHtml,
    localDayBoundaries,
    percentOf,
    viewOf,
} from '../../ui/timeline.js';
import { rotationSlots, rotationWindow } from '../../core/schedule.js';
import { ctx } from './state.js';
import { ROTATION_DAYS } from './constants.js';

/** "03" (or "08:30" where the time zone is off the full hour): a moment's local time, short. */
function hourLabel(ms) {
    const date = new Date(ms);
    const hours = pad2(date.getHours());
    return date.getMinutes() === 0 ? hours : `${hours}:${pad2(date.getMinutes())}`;
}

/** One slot's hover card: the phase and its times in local time. */
function slotTooltip(slot) {
    return [localizedName(slot.phase.name), formatRunRange(slot.start, slot.end)].join('\n');
}

/**
 * Event rotations (Survival Battle): a chart each, in the user's local time: today and the next 6 local days as
 * columns (midnight to midnight), one row per phase with a bar for each of its slots at the time it starts (so one can
 * run over midnight, e.g. 23:00 to 03:00; the ones already over grey), the day's own time slots (04:00, 08:00, ...) as
 * hours above the rows with a faint line each, and a line for the phase on now.
 */
function renderEventRotations() {
    const container = document.getElementById('event-rotations');
    if (!container || !ctx.packData) {
        return;
    }
    const nowMs = Date.now();
    const boundaries = localDayBoundaries(nowMs, ROTATION_DAYS);
    const view = viewOf(boundaries);
    const days = boundaries.slice(0, -1);
    container.innerHTML = Object.values(ctx.packData.event_rotations || {})
        .map((rotation) => {
            const slots = rotationWindow(rotation, view.from, view.to);
            const { current, next } = rotationSlots(rotation, nowMs);
            const rowsHtml = rotation.phases
                .map((phase) => {
                    const name = localizedName(phase.name);
                    const bars = slots
                        .filter((slot) => slot.phaseId === phase.id)
                        .map((slot) =>
                            barHtml(
                                {
                                    start: slot.start,
                                    end: slot.end,
                                    past: slot.end <= nowMs,
                                    active: slot.start <= nowMs && nowMs < slot.end,
                                },
                                view,
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
                    ? days.flatMap((midnight) => {
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
                          .filter((ms) => ms > view.from && ms < view.to)
                          .sort((a, b) => a - b);
            const hours = ticks.map(
                (ms) => `<span class="schedule__hour" style="left: ${percentOf(ms, view)}%">${hourLabel(ms)}</span>`,
            );
            const nowLine = t('calendar.eventRotation.now', {
                current: localizedName(current.phase.name),
                time: formatClock(current.end),
                next: localizedName(next.phase.name),
            });
            // The chart is drawn again when the phase on now ends (or its first day, or the game day, does).
            return `
                <section class="card schedule schedule--event-rotation">
                    <h2>${escapeHtml(localizedName(ctx.packData.events[rotation.event_id].name))}</h2>
                    <p class="text-dim">${tHtml('calendar.eventRotation.lead')}</p>
                    <div class="schedule__body">
                        <div class="schedule__legend">
                            <span><i class="schedule__swatch schedule__swatch--today"></i>${escapeHtml(nowLine)}</span>
                            <span><i class="schedule__swatch schedule__swatch--active"></i>${tHtml('calendar.eventRotation.active')}</span>
                            <span><i class="schedule__swatch schedule__swatch--upcoming"></i>${tHtml('calendar.eventRotation.upcoming')}</span>
                            <span><i class="schedule__swatch schedule__swatch--past"></i>${tHtml('calendar.schedule.past')}</span>
                        </div>
                        <div class="schedule__scroll">
                            <div class="schedule__chart schedule__chart--days" ${chartAttrs(boundaries, 1, nowMs, current.end)}>
                                <div class="schedule__row schedule__row--axis">
                                    <div class="schedule__label"></div>
                                    <div class="schedule__track schedule__weeks" style="${columnsStyle(boundaries, 1)}">${dayHeadersHtml(boundaries)}</div>
                                </div>
                                ${hours.length > 0 ? `<div class="schedule__row schedule__row--hours" aria-hidden="true"><div class="schedule__label"></div><div class="schedule__track">${hours.join('')}</div></div>` : ''}
                                ${rowsHtml}
                                ${gridHtml(boundaries, 1, ticks)}
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

export { renderEventRotations };
