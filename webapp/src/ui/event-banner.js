/**
 * The game's art for events, spend reward tracks and seasonal passes (`image` in pack_data.json:
 * assets/events/<image>.webp, 720×360), and when they run: "Ends in 6d 5h", "Starts in 05:06:44" (a live countdown on
 * the banners; runs start and end at the game day's reset, 02:00 UTC). Used by the Calendar (thumbnails, hover
 * cards), the Shopping Plan and Spend Rewards (banners).
 */
import { getLocale, t } from './i18n.js';
import { escapeHtml } from './html.js';
import { packageFamilyId } from '../core/pack-data.js';
import { dayDate, forecastRuns, gameDay, runMoments, runStatus, scheduleRuns } from '../core/schedule.js';

const EVENT_IMAGES_URL = `${import.meta.env.BASE_URL}assets/events/`;
// How far ahead a forecast is looked for ("next expected around …").
const FORECAST_DAYS = 180;

/** URL of an `image`, or null. */
function eventImageUrl(image) {
    return image ? `${EVENT_IMAGES_URL}${encodeURIComponent(image)}.webp` : null;
}

/** The `image` of a schedule id: an event, a spend reward track or a seasonal pass family. */
function scheduleImage(data, id) {
    const entry = data.events?.[id] || data.spend_reward_tracks?.[id];
    if (entry) {
        return entry.image || null;
    }
    const pass = Object.entries(data.packages || {}).find(
        ([pkgId, pkg]) => pkg.image && packageFamilyId(pkgId, pkg) === id,
    );
    return pass ? pass[1].image : null;
}

/** "Mon, Oct 12" (a day number, shown as the game's date in any time zone). */
function formatGameDay(day, options = { weekday: 'short', day: 'numeric', month: 'short' }) {
    return dayDate(day).toLocaleDateString(getLocale(), { timeZone: 'UTC', ...options });
}

/** "6d 5h" from a day on, else a clock "05:06:44" (the last 24 hours). */
function durationText(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    if (seconds >= 86400) {
        return t('calendar.status.daysHours', {
            days: Math.floor(seconds / 86400),
            hours: Math.floor((seconds % 86400) / 3600),
        });
    }
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

/** The moment a running run ends or an upcoming one starts (runs start and end at the game day's reset). */
function statusMoment(status) {
    const moments = runMoments(status.run);
    return status.state === 'running' ? moments.end : moments.start;
}

/** "Ends in 6d 5h" / "Starts in 05:06:44" (as of `now`), "Ended 5 days ago" for a runStatus result. */
function runStatusText(status, now = Date.now()) {
    if (status.state === 'running') {
        return t('calendar.status.endsIn', { time: durationText(statusMoment(status) - now) });
    }
    if (status.state === 'upcoming') {
        return t('calendar.status.startsIn', { time: durationText(statusMoment(status) - now) });
    }
    return status.days === 1
        ? t('calendar.status.endedYesterday')
        : t('calendar.status.endedAgo', { count: status.days });
}

/** "Sun, Oct 25, 04:00" in local time. */
function formatMoment(ms) {
    return new Date(ms).toLocaleString(getLocale(), {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * When a schedule id runs, as of now (today is the game day): `{ state, text }`, `state` one of running / upcoming /
 * ended / none. Running and upcoming runs also give their dates (`range`), the moment they end / start (`until`, for
 * a live countdown) and that moment in local time (`exact`); after the last run, the next forecast run if any.
 */
function scheduleTiming(data, id) {
    const runs = scheduleRuns(data).get(id)?.runs || [];
    const now = Date.now();
    const today = gameDay(new Date(now)).day;
    const status = runStatus(runs, today);
    if (!status) {
        return { state: 'none', text: t('calendar.status.none') };
    }
    if (status.state !== 'ended') {
        const range = `${formatGameDay(status.run.start)} – ${formatGameDay(status.run.end)}`;
        const until = statusMoment(status);
        return {
            state: status.state,
            status,
            range,
            until,
            exact: t(status.state === 'running' ? 'calendar.status.endsAt' : 'calendar.status.startsAt', {
                date: formatMoment(until),
            }),
            text: `${range} · ${runStatusText(status, now)}`,
        };
    }
    const [next] = forecastRuns(runs, { from: today, to: today + FORECAST_DAYS, today });
    const expected = next ? ` · ${t('calendar.status.expected', { date: formatGameDay(next.start) })}` : '';
    return { state: 'ended', text: `${runStatusText(status, now)}${expected}` };
}

/** The timing line: dates and a countdown that `startCountdowns` keeps current (hover: the exact local moment). */
function timingHtml(timing) {
    const className = `event-banner__timing event-banner__timing--${timing.state}`;
    if (!timing.until) {
        return `<p class="${className}">${escapeHtml(timing.text)}</p>`;
    }
    return `<p class="${className}" title="${escapeHtml(timing.exact)}">${escapeHtml(timing.range)} · <span class="event-banner__countdown" data-until="${timing.until}" data-state="${timing.state}">${escapeHtml(runStatusText(timing.status))}</span></p>`;
}

/**
 * A banner: the art on the right, fading into the card, with the name and when it runs on the left. Without art the
 * same strip without the picture (so the layout doesn't jump between entries).
 */
function eventBannerHtml({ image, name, timing }) {
    const url = eventImageUrl(image);
    const art = url ? `<img class="event-banner__art" src="${url}" alt="" loading="lazy" decoding="async" />` : '';
    return `
        <div class="event-banner${url ? '' : ' event-banner--plain'}">
            ${art}
            <div class="event-banner__text">
                <h3 class="event-banner__name">${escapeHtml(name)}</h3>
                ${timing ? timingHtml(timing) : ''}
            </div>
        </div>`;
}

// One timer for the page's countdowns (a page shows one banner at a time).
let countdownTimer = null;

/**
 * Keeps the countdowns under `root` current, every second. When one runs out (the run ended or started) `onExpire`
 * renders the banner again, so it shows the new state.
 */
function startCountdowns(root, onExpire) {
    window.clearInterval(countdownTimer);
    const countdowns = [...root.querySelectorAll('.event-banner__countdown[data-until]')];
    if (countdowns.length === 0) {
        return;
    }
    countdownTimer = window.setInterval(() => {
        const now = Date.now();
        for (const element of countdowns) {
            const remaining = Number(element.dataset.until) - now;
            if (remaining <= 0) {
                window.clearInterval(countdownTimer);
                onExpire();
                return;
            }
            const key = element.dataset.state === 'running' ? 'calendar.status.endsIn' : 'calendar.status.startsIn';
            element.textContent = t(key, { time: durationText(remaining) });
        }
    }, 1000);
}

export { eventImageUrl, scheduleImage, formatGameDay, runStatusText, scheduleTiming, eventBannerHtml, startCountdowns };
