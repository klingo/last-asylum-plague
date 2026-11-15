/**
 * Calendar: the Event Schedule (recorded runs and their forecast, `scheduleRuns` / `forecastRuns` in core/schedule.js;
 * each entry with the game's art and a hover card), the Weekday Offers of the next 7 days (`weekly_rotation` packs by
 * their `available_days`, coloured by their ratio), for each event rotation (Survival Battle, Alliance Duel) a chart
 * of the slot on now and the 24 hours after it (today and the next 6 days for day-long slots): one row per phase, a bar per slot with the
 * activities that give points in its hover card, and the Kingdom War (its weeks, the break and the Royal City
 * Scramble, `core/kingdom-war.js`) over 4 weeks. Every chart is on the user's local days (`ui/timeline.js`); the
 * game's day starts at 02:00 UTC, where its runs' bars begin and end. Every card collapses (`ui/collapsible.js`).
 */
import { startPage } from '../../ui/page.js';
import '../../styles/pages/calendar.css';
import { buildValuation } from '../../ui/valuation.js';
import { withLoading } from '../../ui/loading.js';
import { getSettings } from '../../ui/settings.js';
import { shareOf } from '../../ui/timeline.js';
import { wireCollapsible } from '../../ui/collapsible.js';
import { gameDay } from '../../core/schedule.js';
import { ctx } from './state.js';
import { nowText, renderRotation } from './rotation.js';
import { renderEventRotations } from './event-rotations.js';
import { renderKingdomWar } from './kingdom-war.js';
import { renderSchedule } from './schedule.js';

function render() {
    renderSchedule();
    renderRotation();
    renderEventRotations();
    renderKingdomWar();
    wireCollapsible(document);
}

/**
 * Every minute: the charts' "Now" lines move on (each chart knows its window, `data-from` / `data-to`); a chart that
 * is over (`data-refresh-at`: a new game or local day, or the phase on now ended) has them all drawn again.
 */
function tickCharts() {
    const nowMs = Date.now();
    const charts = [...document.querySelectorAll('.schedule__chart[data-from]')];
    if (charts.some((chart) => nowMs >= Number(chart.dataset.refreshAt))) {
        render();
        return;
    }
    for (const chart of charts) {
        const view = { from: Number(chart.dataset.from), to: Number(chart.dataset.to) };
        chart.style.setProperty('--today', String(shareOf(nowMs, view)));
    }
    const nowLabel = document.querySelector('#rotation .schedule__now-text');
    if (nowLabel) {
        nowLabel.textContent = nowText(gameDay(new Date(nowMs)).day);
    }
}

startPage('calendar', {
    async init(data) {
        ctx.packData = data;
        await withLoading(async () => {
            ctx.valuation = await buildValuation(data, getSettings());
        });
        render();
        window.setInterval(tickCharts, 60000);
    },
    onLocaleChange: render,
});
