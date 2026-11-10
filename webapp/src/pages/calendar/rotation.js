/**
 * The Weekday Offers chart: today and the next 6 local days, with how long today's offers last. Each offer has its own
 * picture (`assets/packages/<pack id>.webp`) as a thumbnail before its name and as the art of its bars' hover cards,
 * greyed there for every bar that isn't on sale right now (as an ended event's).
 */
import { formatDays, localizedName, t, tHtml } from '../../ui/i18n.js';
import { formatThousands } from '../../ui/format.js';
import { ratioColor } from '../../ui/ratio-bar.js';
import { escapeHtml } from '../../ui/html.js';
import { formatClock, formatDaySpan } from '../../ui/datetime.js';
import { enableInfoTooltips } from '../../ui/tooltip.js';
import { hydratePackThumbs, packThumbHtml } from '../../ui/event-banner.js';
import { packageImageUrl } from '../../ui/images.js';
import {
    barHtml,
    chartAttrs,
    columnsStyle,
    dayHeadersHtml,
    gridHtml,
    localDayBoundaries,
    viewOf,
} from '../../ui/timeline.js';
import { packageFamilyId } from '../../core/pack-data.js';
import { dayStartMs, gameDay, runMoments, weekdayRuns } from '../../core/schedule.js';
import { ctx } from './state.js';
import { ROTATION_DAYS } from './constants.js';

/** "5h 12m", "42m": how long until a moment (whole minutes; the chart updates once a minute). */
function untilText(ms) {
    const minutes = Math.max(0, Math.floor(ms / 60000));
    return minutes >= 60
        ? t('calendar.rotation.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
        : t('calendar.rotation.minutes', { minutes });
}

/** "Now · today's offers end in 5h 12m (a new game day starts at 04:00)": the game day `day` ends at the next reset. */
function nowText(day) {
    const nextReset = dayStartMs(day + 1);
    return t('calendar.rotation.now', { left: untilText(nextReset - Date.now()), time: formatClock(nextReset) });
}

/**
 * One line on what's worth it: the offers with a ratio of 1.0 or more (best first, with their weekdays), or, if none
 * is, that none is and which comes closest. Empty without ratios.
 */
function rotationSummary(rows) {
    const ranked = rows.filter((row) => row.ratio !== null).sort((a, b) => b.ratio - a.ratio);
    if (ranked.length === 0) {
        return '';
    }
    const worthIt = ranked.filter((row) => row.ratio >= 1);
    return worthIt.length > 0
        ? t('calendar.rotation.worthIt', {
              offers: worthIt.map((row) => `${row.name} (${formatDays(row.days)})`).join(', '),
          })
        : t('calendar.rotation.noneWorthIt', { name: ranked[0].name, ratio: formatThousands(ranked[0].ratio, 2) });
}

/**
 * Weekday offers (`weekly_rotation` packs): today and the next 6 local days, one row per pack family (a bar from the
 * reset that starts the offer's game day to the one that ends it), with a line for now (and how long today's offers
 * last) and a line on which are worth it.
 */
function renderRotation() {
    const section = document.getElementById('rotation');
    if (!section || !ctx.packData) {
        return;
    }
    const nowMs = Date.now();
    const boundaries = localDayBoundaries(nowMs, ROTATION_DAYS);
    const view = viewOf(boundaries);
    const firstDay = gameDay(new Date(view.from)).day;
    const lastDay = gameDay(new Date(view.to - 1)).day;
    const families = new Map();
    for (const [id, pkg] of Object.entries(ctx.packData.packages || {})) {
        if (pkg.category !== 'weekly_rotation') {
            continue;
        }
        const familyId = packageFamilyId(id, pkg);
        // The family's best ratio over its tiers (the Deal Ranking's number), if all its contents have a worth.
        const ratio = ctx.valuation.bundle(pkg, pkg.price).ratio;
        const entry = families.get(familyId) || { pkg, ratio: null };
        if (Number.isFinite(ratio) && !(entry.ratio >= ratio)) {
            entry.ratio = ratio;
        }
        families.set(familyId, entry);
    }
    const rows = [...families]
        .map(([familyId, { pkg, ratio }]) => {
            const name = localizedName(pkg.name);
            // The name with the ratio right-aligned (a tab splits the line, see tooltip.js); each bar adds its own sale
            // window (exact, in local time: a weekday is the game's).
            const tooltip = ratio === null ? name : `${name}\t${t('common.table.ratio')}: ${formatThousands(ratio, 2)}`;
            return {
                name,
                tooltip,
                ratio,
                days: pkg.available_days,
                packId: familyId,
                imageUrl: packageImageUrl(familyId), // the hover card's art (left out where the pack has no picture)
                bars: weekdayRuns(pkg.available_days, firstDay, lastDay, { merge: pkg.limit_type !== 'daily' }).map(
                    (run) => {
                        const { start, end } = runMoments(run);
                        return { start, end, past: end <= nowMs };
                    },
                ),
            };
        })
        .filter((row) => row.bars.length > 0)
        .sort((a, b) => a.bars[0].start - b.bars[0].start || a.name.localeCompare(b.name));
    if (rows.length === 0) {
        section.hidden = true;
        return;
    }
    // The Deal Ranking's ratio colours (fixed scale around 1.0: red up to 0.85, amber at 1.0, green from 1.15).
    for (const row of rows) {
        row.color = row.ratio === null ? null : ratioColor(row.ratio);
    }

    const rowsHtml = rows
        .map(
            (row) => `
                <div class="schedule__row schedule__row--rotation">
                    <div class="schedule__label" title="${escapeHtml(row.name)}">${packThumbHtml(row.packId)}${escapeHtml(row.name)}</div>
                    <div class="schedule__track">${row.bars.map((bar) => barHtml(bar, view, `${row.tooltip}\n${formatDaySpan(bar.start, bar.end)}`, { color: row.color, image: row.imageUrl, mutedImage: !(bar.start <= nowMs && nowMs < bar.end) })).join('')}</div>
                </div>`,
        )
        .join('');
    const summary = rotationSummary(rows);
    section.hidden = false;
    section.querySelector('.schedule__body').innerHTML = `
        <div class="schedule__legend">
            <span><i class="schedule__swatch schedule__swatch--today"></i><span class="schedule__now-text">${escapeHtml(nowText(gameDay(new Date(nowMs)).day))}</span></span>
            <span>${tHtml('calendar.rotation.colour')}</span>
        </div>
        <div class="schedule__scroll">
            <div class="schedule__chart schedule__chart--days" ${chartAttrs(boundaries, 1, nowMs)}>
                <div class="schedule__row schedule__row--axis">
                    <div class="schedule__label"></div>
                    <div class="schedule__track schedule__weeks" style="${columnsStyle(boundaries, 1)}">${dayHeadersHtml(boundaries)}</div>
                </div>
                ${rowsHtml}
                ${gridHtml(boundaries, 1)}
                <div class="schedule__current-week" aria-hidden="true"></div>
                <div class="schedule__today" aria-hidden="true"></div>
            </div>
        </div>
        ${summary ? `<p class="schedule__summary">${escapeHtml(summary)}</p>` : ''}`;
    hydratePackThumbs(section); // an offer without its picture yet gets the placeholder, as an event without art
    enableInfoTooltips(section);
}

export { nowText, renderRotation };
