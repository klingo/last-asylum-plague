/**
 * The Weekday Offers chart: today and the next 6 days, with how long today's offers last.
 */
import { formatDays, getLocale, localizedName, t, tHtml } from '../../ui/i18n.js';
import { formatThousands } from '../../ui/format.js';
import { ratioColor } from '../../ui/ratio-bar.js';
import { escapeHtml } from '../../ui/html.js';
import { formatClock, formatGameDay } from '../../ui/datetime.js';
import { enableInfoTooltips } from '../../ui/tooltip.js';
import { createItemImage } from '../../ui/images.js';
import { itemDisplayText, packageIcon } from '../../ui/labels.js';
import { packageFamilyId } from '../../core/pack-data.js';
import { GAME_DAY_START_MS, dayDate, gameDay, weekdayRuns } from '../../core/schedule.js';
import { ctx } from './state.js';
import { ROTATION_DAYS } from './constants.js';
import { barHtml, gridHtml } from './schedule.js';

/** "5h 12m", "42m": how long until a moment (whole minutes; the chart updates once a minute). */
function untilText(ms) {
    const minutes = Math.max(0, Math.floor(ms / 60000));
    return minutes >= 60
        ? t('calendar.rotation.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
        : t('calendar.rotation.minutes', { minutes });
}

/** "Now · today's offers end in 5h 12m (a new game day starts at 04:00)": the game day `day` ends at the next reset. */
function nowText(day) {
    const nextReset = dayDate(day + 1).getTime() + GAME_DAY_START_MS;
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

/** The weekday columns of a day chart: "Today", "Tomorrow", then the weekday, each with its date; `from` = first game day. */
function dayHeadersHtml(from) {
    return Array.from({ length: ROTATION_DAYS }, (_, index) => from + index)
        .map((day, index) => {
            const label =
                index < 2
                    ? t(index === 0 ? 'calendar.rotation.today' : 'calendar.rotation.tomorrow')
                    : formatGameDay(day, { weekday: 'long' });
            return `
                <div class="schedule__week${index === 0 ? ' schedule__week--current' : ''}">
                    <strong>${escapeHtml(label)}</strong>
                    <span>${escapeHtml(formatGameDay(day, { day: 'numeric', month: 'short' }))}</span>
                </div>`;
        })
        .join('');
}

/** When a weekday offer's bar (whole game days `start`..`end`) is on sale, in the user's time: "Thu 03:00 AM". */
function saleWindowText(bar) {
    const at = (day) =>
        new Date(dayDate(day).getTime() + GAME_DAY_START_MS).toLocaleString(getLocale(), {
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    return t('calendar.rotation.onSale', { from: at(bar.start), to: at(bar.end + 1) });
}

/**
 * Weekday offers (`weekly_rotation` packs): today and the next 6 game days, one row per pack family, with a line
 * for now (and how long today's offers last) and a line on which are worth it.
 */
function renderRotation() {
    const section = document.getElementById('rotation');
    if (!section || !ctx.packData) {
        return;
    }
    const now = gameDay(new Date());
    const from = now.day;
    const to = from + ROTATION_DAYS - 1;
    ctx.rotationDay = from;
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
    const rows = [...families.values()]
        .map(({ pkg, ratio }) => {
            const name = localizedName(pkg.name);
            const tooltip = [
                name,
                t('calendar.rotation.every', { days: formatDays(pkg.available_days) }),
                ratio === null ? '' : `${t('common.table.ratio')}: ${formatThousands(ratio, 2)}`,
            ]
                .filter(Boolean)
                .join('\n');
            return {
                name,
                tooltip,
                ratio,
                days: pkg.available_days,
                icon: packageIcon(pkg),
                bars: weekdayRuns(pkg.available_days, from, to, { merge: pkg.limit_type !== 'daily' }),
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

    const days = dayHeadersHtml(from);
    const rowsHtml = rows
        .map(
            (row) => `
                <div class="schedule__row schedule__row--rotation">
                    <div class="schedule__label" title="${escapeHtml(row.name)}" data-icon="${escapeHtml(row.icon || '')}">${escapeHtml(row.name)}</div>
                    <div class="schedule__track">${row.bars.map((bar) => barHtml(bar, from, to, `${row.tooltip}\n${saleWindowText(bar)}`, { color: row.color })).join('')}</div>
                </div>`,
        )
        .join('');
    const summary = rotationSummary(rows);
    section.hidden = false;
    section.querySelector('.schedule__body').innerHTML = `
        <div class="schedule__legend">
            <span><i class="schedule__swatch schedule__swatch--today"></i><span class="schedule__now-text">${escapeHtml(nowText(from))}</span></span>
            <span>${tHtml('calendar.rotation.colour')}</span>
        </div>
        <div class="schedule__scroll">
            <div class="schedule__chart schedule__chart--days" style="--columns: ${ROTATION_DAYS}; --week-start: 0; --week-width: ${1 / ROTATION_DAYS}; --today: ${now.fraction / ROTATION_DAYS}">
                <div class="schedule__row schedule__row--axis">
                    <div class="schedule__label"></div>
                    <div class="schedule__track schedule__weeks">${days}</div>
                </div>
                ${rowsHtml}
                ${gridHtml(ROTATION_DAYS, 1)}
                <div class="schedule__current-week" aria-hidden="true"></div>
                <div class="schedule__today" aria-hidden="true"></div>
            </div>
        </div>
        ${summary ? `<p class="schedule__summary">${escapeHtml(summary)}</p>` : ''}`;
    // Icons via createItemImage (placeholder if the image is missing, item name as mouse-over).
    for (const label of section.querySelectorAll('.schedule__label[data-icon]')) {
        const itemId = label.dataset.icon;
        if (itemId) {
            label.prepend(
                createItemImage(itemId, itemDisplayText(ctx.packData.items, itemId), 'item-icon schedule__icon'),
            );
        }
    }
    enableInfoTooltips(section);
}

export { nowText, renderRotation };
