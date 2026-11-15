/**
 * The event rotations (Survival Battle, Alliance Duel): a chart of the slot on now and the 24 hours after it (a
 * rotation of day-long slots: today and the next 6 days), a phase's own art (its `image`; a placeholder tile without)
 * as a small thumbnail before its name and as the art of its bars' hover cards, which also list the activities that
 * give points in the phase. A slot that runs while the phase of the other rotation it pairs with is on (the same
 * action counts for both: Survival Battle's Build Territory on the Alliance Duel's Territory Development day) has a
 * ring around its bar and the other event's name in it ("+ Alliance Duel"), and says so in its hover card.
 */
import { localizedName, t, tHtml } from '../../ui/i18n.js';
import { escapeHtml } from '../../ui/html.js';
import { formatClock, formatDaySpan, formatRunRange } from '../../ui/datetime.js';
import { eventImageUrl, thumbHtml } from '../../ui/event-banner.js';
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
    windowBoundaries,
} from '../../ui/timeline.js';
import { HOUR_MS, pairedSlot, rotationSlots, rotationWindow } from '../../core/schedule.js';
import { ctx } from './state.js';
import { EVENT_ROTATION_DAY_HOURS, EVENT_ROTATION_HOURS, ROTATION_DAYS } from './constants.js';

/**
 * The activities of a phase that give points, one line each for a hover card (the points themselves are left out: the
 * activity needs the room). After an empty line, which sets the list off from the lines above it (see tooltip.js);
 * none without rules.
 */
function earnLines(phase) {
    const lines = (phase.earn_points || []).map((rule) => localizedName(rule.text));
    return lines.length > 0 ? ['', ...lines] : [];
}

/** The name of the event of the rotation with the key `rotationId` (a rotation's key is its event's id). */
function rotationEventName(rotationId) {
    return localizedName(ctx.packData.events[rotationId].name);
}

/**
 * One slot's hover card: the phase, its times in local time (a day-long slot as the Weekday Offers show theirs), the
 * phase of the other rotation the same action counts for too (`paired`, if any) and the activities that give points
 * in it.
 */
function slotTooltip(slot, daySlot, paired) {
    return [
        localizedName(slot.phase.name),
        (daySlot ? formatDaySpan : formatRunRange)(slot.start, slot.end),
        ...(paired
            ? [
                  t('calendar.eventRotation.pairedWith', {
                      event: rotationEventName(slot.phase.pairs_with.rotation),
                      phase: localizedName(paired.phase.name),
                  }),
              ]
            : []),
        ...earnLines(slot.phase),
    ].join('\n');
}

/**
 * Event rotations (Survival Battle, Alliance Duel): a chart each, in the user's local time. A rotation of day-long
 * slots shows today and the next 6 days; any other goes from the start of the slot on now (or of the local day, if it
 * began yesterday) to 24 hours after it ends, as local day columns cut to that window. One row per phase with a bar for
 * each of its slots (one can run over midnight, e.g. 23:00 to 03:00), the slots' start times as hours above the rows
 * with a faint line each, and a line for now. The legend also explains the ring of a paired slot.
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
            // Between phases (the Alliance Duel's Sunday) the window of the other rotations starts at the next one.
            const anchor = current ?? next;
            const daysView = rotation.hours === EVENT_ROTATION_DAY_HOURS;
            const boundaries = daysView
                ? localDayBoundaries(nowMs, ROTATION_DAYS)
                : windowBoundaries(Math.max(anchor.start, midnight), anchor.end + EVENT_ROTATION_HOURS * HOUR_MS);
            const view = viewOf(boundaries);
            const slots = rotationWindow(rotation, view.from, view.to);
            const rowsHtml = rotation.phases
                .map((phase) => {
                    const name = localizedName(phase.name);
                    const image = eventImageUrl(phase.image); // null without one
                    const bars = slots
                        .filter((slot) => slot.phaseId === phase.id)
                        .map((slot) => {
                            const paired = pairedSlot(ctx.packData.event_rotations, slot);
                            return barHtml(
                                {
                                    start: slot.start,
                                    end: slot.end,
                                    active: slot.start <= nowMs && nowMs < slot.end,
                                },
                                view,
                                slotTooltip(slot, daysView, paired),
                                paired
                                    ? {
                                          image,
                                          className: 'schedule__bar--paired',
                                          label: `+ ${rotationEventName(slot.phase.pairs_with.rotation)}`,
                                      }
                                    : { image },
                            );
                        });
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
            const nowLine = current
                ? t('calendar.eventRotation.now', {
                      current: localizedName(current.phase.name),
                      time: formatClock(current.end),
                      next: localizedName(next.phase.name),
                  })
                : t('calendar.eventRotation.nowOff', {
                      time: formatClock(next.start),
                      next: localizedName(next.phase.name),
                  });
            // One legend entry for each other rotation some phase pairs with (ringed bars).
            const pairedLegend = [...new Set(rotation.phases.map((phase) => phase.pairs_with?.rotation))]
                .filter(Boolean)
                .map(
                    (rotationId) =>
                        `<span><i class="schedule__swatch schedule__swatch--paired"></i>${tHtml('calendar.eventRotation.paired', { event: escapeHtml(rotationEventName(rotationId)) })}</span>`,
                )
                .join('');
            // The chart is drawn again when the phase on now ends (between phases: when the next one starts).
            return `
                <section class="card schedule schedule--event-rotation${daysView ? ' schedule--event-rotation-days' : ''}">
                    <details data-section="${escapeHtml(rotation.event_id)}" open>
                    <summary class="card-toggle"><h2>${escapeHtml(localizedName(ctx.packData.events[rotation.event_id].name))}</h2></summary>
                    <p class="text-dim">${tHtml(daysView ? 'calendar.eventRotation.leadDays' : 'calendar.eventRotation.lead')}</p>
                    <div class="schedule__body">
                        <div class="schedule__legend">
                            <span><i class="schedule__swatch schedule__swatch--today"></i>${escapeHtml(nowLine)}</span>
                            <span><i class="schedule__swatch schedule__swatch--active"></i>${tHtml('calendar.eventRotation.active')}</span>
                            <span><i class="schedule__swatch schedule__swatch--upcoming"></i>${tHtml('calendar.eventRotation.upcoming')}</span>
                            ${pairedLegend}
                        </div>
                        <div class="schedule__scroll">
                            <div class="schedule__chart schedule__chart--days" ${chartAttrs(boundaries, 1, nowMs, current ? current.end : next.start)}>
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
                    </details>
                </section>`;
        })
        .join('');
    enableInfoTooltips(container);
}

export { renderEventRotations };
