/**
 * Calendar: the Event Schedule (recorded runs and their forecast, `scheduleRuns` / `forecastRuns` in core/schedule.js;
 * each entry with the game's art and a hover card), the Weekday Offers of the next 7 days (`weekly_rotation` packs by
 * their `available_days`, coloured by their ratio) and, for each event rotation (Survival Battle), a chart of today and
 * the next 6 days: one row per phase, a bar per slot. Times are shown in the local time zone; the game's day starts at
 * 02:00 UTC.
 */
import { startPage } from '../../ui/page.js';
import '../../styles/pages/calendar.css';
import { buildValuation } from '../../ui/valuation.js';
import { withLoading } from '../../ui/loading.js';
import { getSettings } from '../../ui/settings.js';
import { gameDay } from '../../core/schedule.js';
import { ctx } from './state.js';
import { ROTATION_DAYS } from './constants.js';
import { renderEventRotations } from './event-rotations.js';
import { nowText, renderRotation } from './rotation.js';
import { renderSchedule } from './schedule.js';

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
    if (now.day !== ctx.rotationDay) {
        render();
        return;
    }
    document
        .querySelector('#rotation .schedule__chart')
        ?.style.setProperty('--today', String(now.fraction / ROTATION_DAYS));
    if (ctx.scheduleWindow) {
        document
            .querySelector('#schedule .schedule__chart')
            ?.style.setProperty(
                '--today',
                String((now.day - ctx.scheduleWindow.from + now.fraction) / ctx.scheduleWindow.total),
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
        ctx.packData = data;
        await withLoading(async () => {
            ctx.valuation = await buildValuation(data, getSettings());
        });
        render();
        window.setInterval(tickRotation, 60000);
    },
    onLocaleChange: render,
});
