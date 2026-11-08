/**
 * The game's art for events, spend reward tracks and seasonal passes (`image` in pack_data.json:
 * assets/events/<image>.webp, 720×360), and when they run: "Ends in 6d 5h", "Starts in 05:06:44" (a live countdown on
 * the banners; runs start and end at the game day's reset, 02:00 UTC, shown in the user's local time). Used by the Calendar (thumbnails, hover
 * cards; also a weekday offer's own picture, `assets/packages/<pack id>.webp`, as its thumbnail), Event Shops, Spend Rewards and Seasonal Passes (banners) and Today (the running and starting entries: their names, links and countdowns).
 */
import { localizedName, t } from './i18n.js';
import { escapeHtml } from './html.js';
import { formatDate, formatRunRange, pad2 } from './datetime.js';
import { eventPlanHref, pageHref } from './url.js';
import { packageFamilyId, seasonalPassFamilies } from '../core/pack-data.js';
import { gameDay, nextRun, runMoments, runStatus, scheduleRuns } from '../core/schedule.js';
import { BASE_URL } from './base-url.js';
import { packageImageUrl } from './images.js';

const EVENT_IMAGES_URL = `${BASE_URL}assets/events/`;
// How far ahead a forecast is looked for ("next expected around …").
const FORECAST_DAYS = 180;

/** URL of an `image`, or null. */
function eventImageUrl(image) {
    return image ? `${EVENT_IMAGES_URL}${encodeURIComponent(image)}.webp` : null;
}

/** The art as a small thumbnail before a name (a placeholder in its group's colour without art); `attrs`: more attributes. */
function thumbHtml(image, attrs = '') {
    return image
        ? `<img class="schedule__thumb"${attrs} src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" />`
        : '<span class="schedule__thumb schedule__thumb--none" aria-hidden="true"></span>';
}

/**
 * A weekday offer's own picture (assets/packages/<pack id>.webp) as that thumbnail. Whether the file exists isn't in
 * the data: `hydratePackThumbs` turns the ones that fail to load into the placeholder of an event without art.
 */
function packThumbHtml(packId) {
    return thumbHtml(packageImageUrl(packId), ' data-pack-thumb');
}

/** Replaces the pack thumbnails under `root` whose picture doesn't exist (yet) by the placeholder. */
function hydratePackThumbs(root) {
    const missing = (img) => {
        const holder = document.createElement('template');
        holder.innerHTML = thumbHtml(null);
        img.replaceWith(holder.content.firstElementChild);
    };
    root.querySelectorAll('img[data-pack-thumb]').forEach((img) => {
        if (img.complete && img.naturalWidth === 0) {
            missing(img); // it failed before this ran
        } else {
            img.addEventListener('error', () => missing(img), { once: true });
        }
    });
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

/** The name of a schedule id: an event, a spend reward track or a seasonal pass family (the id itself if unknown). */
function scheduleName(data, id) {
    const entry =
        data.events?.[id] ||
        data.spend_reward_tracks?.[id] ||
        Object.entries(data.packages || {}).find(([pkgId, pkg]) => packageFamilyId(pkgId, pkg) === id)?.[1];
    return entry ? localizedName(entry.name) : id;
}

/**
 * Where a schedule id is planned: a ticked event (`activeEvents`) on Event Shops, a spend reward track on Spend
 * Rewards, a seasonal pass on Seasonal Passes (in-game events have no page of their own); null otherwise.
 */
function scheduleHref(data, id, activeEvents) {
    if (seasonalPassFamilies(data.packages).has(id)) {
        return pageHref('seasonal-passes', { pass: id });
    }
    if (data.events?.[id]?.category !== 'ingame_event' && activeEvents?.includes(id)) {
        return eventPlanHref(id);
    }
    return data.spend_reward_tracks?.[id] ? pageHref('spend-rewards', { track: id }) : null;
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
    return `${pad2(Math.floor(seconds / 3600))}:${pad2(Math.floor((seconds % 3600) / 60))}:${pad2(seconds % 60)}`;
}

/** The moment a running run ends or an upcoming one starts (runs start and end at the game day's reset). */
function statusMoment(status) {
    const moments = runMoments(status.run);
    return status.state === 'running' ? moments.end : moments.start;
}

/** "Ends in 6d 5h" (`state` running) / "Starts in 05:06:44" (upcoming): the countdown to `until` (ms) as of `now`. */
function countdownText(state, until, now = Date.now()) {
    return t(state === 'running' ? 'calendar.status.endsIn' : 'calendar.status.startsIn', {
        time: durationText(until - now),
    });
}

/** "Ends in 6d 5h" / "Starts in 05:06:44" (as of `now`), "Ended 5 days ago" for a runStatus result. */
function runStatusText(status, now = Date.now()) {
    if (status.state === 'running' || status.state === 'upcoming') {
        return countdownText(status.state, statusMoment(status), now);
    }
    return status.days === 1
        ? t('calendar.status.endedYesterday')
        : t('calendar.status.endedAgo', { count: status.days });
}

/**
 * When a schedule id runs, as of now (today is the game day): `{ state, text }`, `state` one of running / upcoming /
 * ended / none. Running and upcoming runs also give when they run in local time (`range`) and the moment they end /
 * start (`until`, for a live countdown); after the last run, the next forecast run if any.
 */
function scheduleTiming(data, id) {
    const now = Date.now();
    const today = gameDay(new Date(now)).day;
    const runs = scheduleRuns(data, today).get(id)?.runs || [];
    const status = runStatus(runs, today);
    if (!status) {
        return { state: 'none', text: t('calendar.status.none') };
    }
    if (status.state !== 'ended') {
        const { start, end } = runMoments(status.run);
        const range = formatRunRange(start, end);
        return {
            state: status.state,
            status,
            range,
            until: statusMoment(status),
            text: `${range} · ${runStatusText(status, now)}`,
        };
    }
    // The next forecast run still to come, said how sure it is.
    const next = nextRun(runs, today, FORECAST_DAYS);
    const expected = next
        ? ` · ${t(next.proven ? 'calendar.status.expected' : 'calendar.status.expectedGuess', { date: formatDate(runMoments(next).start) })}`
        : '';
    return { state: 'ended', text: `${runStatusText(status, now)}${expected}` };
}

/** The timing line: when it runs and a countdown that `startCountdowns` keeps current. */
function timingHtml(timing) {
    const className = `event-banner__timing event-banner__timing--${timing.state}`;
    if (!timing.until) {
        return `<p class="${className}">${escapeHtml(timing.text)}</p>`;
    }
    return `<p class="${className}">${escapeHtml(timing.range)} · <span class="event-banner__countdown" data-until="${timing.until}" data-state="${timing.state}">${escapeHtml(runStatusText(timing.status))}</span></p>`;
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
            element.textContent = countdownText(element.dataset.state, Number(element.dataset.until), now);
        }
    }, 1000);
}

/**
 * Shows the banner of the schedule id `id` in `container` (`entry`: its `{ image, name }`; hidden when null) and
 * keeps its countdown going; `render` draws the page again when the countdown runs out (the run ended or started).
 */
function mountBanner(container, data, id, entry, render) {
    container.hidden = !entry;
    container.innerHTML = entry ? eventBannerHtml({ ...entry, timing: scheduleTiming(data, id) }) : '';
    startCountdowns(container, render);
}

export {
    eventImageUrl,
    thumbHtml,
    packThumbHtml,
    hydratePackThumbs,
    scheduleImage,
    scheduleName,
    scheduleHref,
    runStatusText,
    countdownText,
    scheduleTiming,
    eventBannerHtml,
    startCountdowns,
    mountBanner,
};
