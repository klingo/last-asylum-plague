/**
 * The game's art for events, spend reward tracks and seasonal passes (`image` in pack_data.json:
 * assets/events/<image>.webp, 720×360), and when they run: "Ends in 2 days", "Starts tomorrow", ... (today is the
 * game day). Used by the Calendar (thumbnails, hover cards), the Events page and Spend Rewards (banners).
 */
import { getLocale, t } from './i18n.js';
import { escapeHtml } from './html.js';
import { packageFamilyId } from '../core/pack-data.js';
import { dayDate, forecastRuns, gameDay, runStatus, scheduleRuns } from '../core/schedule.js';

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

/** "Ends in 3 days", "Starts tomorrow", "Ended 5 days ago" for a runStatus result. */
function runStatusText(status) {
    const { state, days } = status;
    if (state === 'running') {
        return days === 0
            ? t('calendar.status.endsToday')
            : days === 1
              ? t('calendar.status.endsTomorrow')
              : t('calendar.status.endsIn', { count: days });
    }
    if (state === 'upcoming') {
        return days === 1 ? t('calendar.status.startsTomorrow') : t('calendar.status.startsIn', { count: days });
    }
    return days === 1 ? t('calendar.status.endedYesterday') : t('calendar.status.endedAgo', { count: days });
}

/**
 * When a schedule id runs, as of today (the game day): `{ state, text }`, `state` one of running / upcoming / ended /
 * none. Running and upcoming runs show their dates; after the last run, the next forecast run if there is one.
 */
function scheduleTiming(data, id) {
    const runs = scheduleRuns(data).get(id)?.runs || [];
    const today = gameDay(new Date()).day;
    const status = runStatus(runs, today);
    if (!status) {
        return { state: 'none', text: t('calendar.status.none') };
    }
    if (status.state !== 'ended') {
        const range = `${formatGameDay(status.run.start)} – ${formatGameDay(status.run.end)}`;
        return { state: status.state, text: `${range} · ${runStatusText(status)}` };
    }
    const [next] = forecastRuns(runs, { from: today, to: today + FORECAST_DAYS, today });
    const expected = next ? ` · ${t('calendar.status.expected', { date: formatGameDay(next.start) })}` : '';
    return { state: 'ended', text: `${runStatusText(status)}${expected}` };
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
                ${timing ? `<p class="event-banner__timing event-banner__timing--${timing.state}">${escapeHtml(timing.text)}</p>` : ''}
            </div>
        </div>`;
}

export { eventImageUrl, scheduleImage, formatGameDay, runStatusText, scheduleTiming, eventBannerHtml };
