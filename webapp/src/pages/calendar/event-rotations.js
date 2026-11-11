/**
 * The event rotations (Survival Battle): a chart of the slot on now and the 24 hours after it, a phase's own art (its
 * `image`; a placeholder tile without) as a small thumbnail before its name and as the art of its bars' hover cards.
 */
import { localizedName, t, tHtml } from '../../ui/i18n.js';
import { escapeHtml } from '../../ui/html.js';
import { formatClock, formatRunRange } from '../../ui/datetime.js';
import { eventImageUrl, thumbHtml } from '../../ui/event-banner.js';
import { enableInfoTooltips } from '../../ui/tooltip.js';
import {
    barHtml,
    chartAttrs,
    columnsStyle,
    dayHeadersHtml,
    gridHtml,
    percentOf,
    viewOf,
    windowBoundaries,
} from '../../ui/timeline.js';
import { HOUR_MS, rotationSlots, rotationWindow } from '../../core/schedule.js';
import { ctx } from './state.js';
import { EVENT_ROTATION_HOURS } from './constants.js';

/** One slot's hover card: the phase and its times in local time. */
function slotTooltip(slot) {
    return [localizedName(slot.phase.name), formatRunRange(slot.start, slot.end)].join('\n');
}

/**
 * Event rotations (Survival Battle): a chart each, in the user's local time: from the start of the slot on now (or
 * of the local day, if it began yesterday) to 24 hours after it ends, as local day columns cut to that window, one
 * row per phase with a bar for each of its slots (one can run over midnight, e.g. 23:00 to 03:00), the slots'
 * start times as hours above the rows with a faint line each, and a line for now.
 */
function renderEventRotations() {
    const container = document.getElementById('event-rotations');
    if (!container || !ctx.packData) {
        return;
    }
    const nowMs = Date.now();
    const today = new Date(nowMs);
    const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    container.innerHTML = Object.values(ctx.packData.event_rotations || {})
        .map((rotation) => {
            const { current, next } = rotationSlots(rotation, nowMs);
            const boundaries = windowBoundaries(
                Math.max(current.start, midnight),
                current.end + EVENT_ROTATION_HOURS * HOUR_MS,
            );
            const view = viewOf(boundaries);
            const slots = rotationWindow(rotation, view.from, view.to);
            const rowsHtml = rotation.phases
                .map((phase) => {
                    const name = localizedName(phase.name);
                    const image = eventImageUrl(phase.image); // null without one
                    const bars = slots
                        .filter((slot) => slot.phaseId === phase.id)
                        .map((slot) =>
                            barHtml(
                                {
                                    start: slot.start,
                                    end: slot.end,
                                    active: slot.start <= nowMs && nowMs < slot.end,
                                },
                                view,
                                slotTooltip(slot),
                                { image },
                            ),
                        );
                    return `
                        <div class="schedule__row schedule__row--ingame">
                            <div class="schedule__label" title="${escapeHtml(name)}">${thumbHtml(image)}${escapeHtml(name)}</div>
                            <div class="schedule__track">${bars.join('')}</div>
                        </div>`;
                })
                .join('');
            // The slots' boundaries as faint lines with the local hour above them (the day's own line stays 00:00's).
            const ticks = [...new Set(slots.flatMap((slot) => [slot.start, slot.end]))]
                .filter((ms) => ms > view.from && ms < view.to)
                .sort((a, b) => a - b);
            const hours = ticks.map(
                (ms) => `<span class="schedule__hour" style="left: ${percentOf(ms, view)}%">${formatClock(ms)}</span>`,
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
