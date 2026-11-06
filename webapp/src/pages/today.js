/**
 * Today (the home page, `index.html`): what runs today (art, name, countdown, linking to its page) and what starts in
 * the next few days (recorded runs and proven forecasts), the phase on now of each event rotation (Survival Battle),
 * the weekly plan by when to buy it (daily packs, weekly and longer packs, each event's packs and shop offers) and
 * today's weekday offers with their ratio.
 */
import { startPage } from '../ui/page.js';
import { mountValuationPage } from '../ui/valuation-page.js';
import { getSettings } from '../ui/settings.js';
import { banknotesAmount, buyBadge, escapeHtml, hydrateItemIcons, itemIconSlot, tileHtml } from '../ui/html.js';
import { enableInfoTooltips } from '../ui/tooltip.js';
import { eventPlanHref, pageHref } from '../ui/url.js';
import { infoIconHtml, requiresIconHtml } from '../ui/info-icon.js';
import { SCHEDULE_KIND_LABELS, SCHEDULE_KINDS, packageDisplayName, packageIcon } from '../ui/labels.js';
import {
    gridCell,
    gridNum,
    gridHeader,
    gridRow,
    gridTable,
    gridDetails,
    detailsToggleHtml,
    wireDetailsToggles,
    breakdownParts,
    packPartRowHtml,
} from '../ui/grid.js';
import { formatDays, getLocale, localizedName, t, tHtml } from '../ui/i18n.js';
import { formatThousands } from '../ui/format.js';
import { ratioCellHtml, ratioScale } from '../ui/ratio-bar.js';
import {
    eventImageUrl,
    countdownText,
    scheduleHref,
    scheduleImage,
    scheduleName,
    slotRangeText,
    startCountdowns,
} from '../ui/event-banner.js';
import { formatGameDayRange } from '../ui/datetime.js';
import { isOnSale } from '../core/catalog.js';
import { packageFamilyId } from '../core/pack-data.js';
import { groupPlanByWhen } from '../core/plan-view.js';
import { WEEKDAYS, gameDay, listRuns, rotationSlots, runMoments, weekdayIndex } from '../core/schedule.js';

// An upcoming entry's fill grows over the last hours before it starts (the same for all, whatever it is).
const SOON_FILL_MS = 4 * 3600000;
// A running entry with less than this left has its countdown in yellow.
const ENDING_MS = 24 * 3600000;
// What starts within this many days is listed under "Starting soon".
const SOON_DAYS = 3;

const scheduleCard = document.getElementById('schedule-card');
const runningList = document.getElementById('running-list');
const soonList = document.getElementById('soon-list');
const offersWrap = document.getElementById('offers-wrap');
const offersEmpty = document.getElementById('offers-empty');
const offersTable = document.getElementById('offers-table');
const planSummary = document.getElementById('plan-summary');
const planTiles = document.getElementById('plan-tiles');

let data = null;
let valuation = null;
// The game day the page shows (a new one renders it all again).
let renderedDay = null;
// The offers' open Details blocks (kept across re-renders).
const offerExpanded = new Set();

/**
 * An entry of a list. `start` / `end` are moments (ms).
 * - A run from the schedule (whole game days): the event's, pass's or track's name, its own short line beside it, the
 *   dates (and "expected" for a forecast), a link if it has a page.
 * - A phase of an event rotation (Survival Battle): the phase's name as the title, the event's name beside it, the
 *   slot's times in local time, and (as an info icon) how to earn points in it.
 */
function runEntry(id, kind, run, state, forecast = false) {
    const moments = runMoments(run);
    const range = formatGameDayRange(run.start, run.end);
    return {
        id,
        kind,
        state,
        forecast,
        title: scheduleName(data, id),
        // The event's own short line, if it has one (the Demon Kings: which heroes deal more damage).
        description: localizedName(data.events?.[id]?.description),
        image: scheduleImage(data, id),
        href: scheduleHref(data, id, getSettings().activeEvents),
        dates: forecast ? `${range} · ${t('today.expected')}` : range,
        start: moments.start,
        end: moments.end,
    };
}

function rotationEntry(rotation, slot, state) {
    const event = data.events[rotation.event_id];
    return {
        id: rotation.event_id,
        kind: 'ingame',
        state,
        forecast: false,
        title: localizedName(slot.phase.name),
        description: localizedName(event.name),
        image: slot.phase.image || event.image,
        href: null,
        dates: slotRangeText(slot.start, slot.end),
        earnPoints: slot.phase.earn_points || [],
        start: slot.start,
        end: slot.end,
    };
}

/**
 * What the plan buys from a running event or pass: "Packs in your plan: 3 (120 Banknotes)" ('' when none, and for
 * tracks, in-game events and phases).
 */
function planShareHtml(entry) {
    if (!valuation || (entry.kind !== 'event' && entry.kind !== 'pass')) {
        return '';
    }
    const mine = valuation.plan.purchases.filter(({ id, pkg }) =>
        entry.kind === 'event' ? pkg.event_id === entry.id : packageFamilyId(id, pkg) === entry.id,
    );
    if (mine.length === 0) {
        return '';
    }
    const spent = mine.reduce((sum, { spend }) => sum + spend, 0);
    return tHtml('today.planPacks', { count: formatThousands(mine.length), spent: banknotesAmount(spent) });
}

/**
 * One entry of a list: its art, title, dates, the countdown in a column of its own and its kind. A faint fill behind it
 * (`updateProgress`) shows how far a running entry is, or, for an upcoming one, how close it is to starting: empty
 * until 4 hours before, full at its start.
 */
function entryHtml(entry) {
    const running = entry.state === 'running';
    const [from, to] = running ? [entry.start, entry.end] : [entry.start - SOON_FILL_MS, entry.start];
    const url = eventImageUrl(entry.image);
    const art = url
        ? `<img class="today-entry__art" src="${url}" alt="" loading="lazy" decoding="async" />`
        : '<span class="today-entry__art today-entry__art--none" aria-hidden="true"></span>';
    const tag = entry.href ? 'a' : 'div';
    const link = entry.href ? ` href="${escapeHtml(entry.href)}"` : '';
    const classes = `today-entry today-entry--${entry.state}${entry.forecast ? ' today-entry--forecast' : ''}`;
    // How to earn points in the phase: an info icon beside the title, its tooltip a heading and the rules, one per
    // line, each with the item's icon.
    const earnRows =
        (entry.earnPoints || []).length > 0
            ? [
                  { text: t('today.earnPoints') },
                  ...entry.earnPoints.map(({ text, item_id: item }) => ({ text: localizedName(text), item })),
              ]
            : null;
    const until = running ? entry.end : entry.start;
    const planShare = running ? planShareHtml(entry) : '';
    return `
        <${tag} class="${classes}" data-from="${from}" data-to="${to}"${link}>
            ${art}
            <div class="today-entry__text">
                <span class="today-entry__title">
                    <span class="today-entry__name">${escapeHtml(entry.title)}</span>
                    ${entry.description ? `<span class="today-entry__description">${escapeHtml(entry.description)}</span>` : ''}
                    ${planShare ? `<span class="today-entry__description">${planShare}</span>` : ''}
                    ${earnRows ? infoIconHtml(earnRows.map((row) => row.text).join('\n'), earnRows) : ''}
                </span>
                <span class="today-entry__dates">${escapeHtml(entry.dates)}</span>
            </div>
            <span class="today-entry__kind">${tHtml(SCHEDULE_KIND_LABELS[entry.kind])}</span>
            <span class="today-entry__time event-banner__countdown" data-until="${until}" data-state="${entry.state}">${escapeHtml(countdownText(entry.state, until))}</span>
        </${tag}>`;
}

/** Sets each entry's fill (0 to 1) from the moments it runs between; called on render and once a minute. */
function updateProgress() {
    const now = Date.now();
    for (const entry of scheduleCard.querySelectorAll('.today-entry[data-from]')) {
        const from = Number(entry.dataset.from);
        const to = Number(entry.dataset.to);
        const fraction = Math.min(1, Math.max(0, (now - from) / (to - from)));
        entry.style.setProperty('--progress', fraction.toFixed(3));
        // Yellow countdown in the last day of a run (so always for an event rotation's 4-hour phases).
        entry.classList.toggle(
            'today-entry--ending',
            entry.classList.contains('today-entry--running') && to - now < ENDING_MS,
        );
    }
}

/**
 * What runs today (ending first) and what starts in the next days: recorded runs and proven forecasts, plus the phase
 * an event rotation (Survival Battle) is in and the one that follows it.
 */
function renderSchedule() {
    const today = gameDay(new Date()).day;
    renderedDay = today;
    const listed = listRuns(data, today, SOON_DAYS);
    const running = listed.running.map(({ id, kind, run, forecast }) => runEntry(id, kind, run, 'running', forecast));
    const soon = listed.soon.map(({ id, kind, run, forecast }) => runEntry(id, kind, run, 'upcoming', forecast));
    const now = Date.now();
    for (const rotation of Object.values(data.event_rotations || {})) {
        const { current, next } = rotationSlots(rotation, now);
        running.push(rotationEntry(rotation, current, 'running'));
        soon.push(rotationEntry(rotation, next, 'upcoming'));
    }
    const order = (a, b) => SCHEDULE_KINDS.indexOf(a.kind) - SCHEDULE_KINDS.indexOf(b.kind);
    // The one ending first on top (the kind only breaks ties).
    running.sort((a, b) => a.end - b.end || order(a, b));
    soon.sort((a, b) => a.start - b.start || order(a, b));
    runningList.innerHTML = running.map(entryHtml).join('') || `<p class="text-dim">${tHtml('today.runningEmpty')}</p>`;
    soonList.innerHTML = soon.map(entryHtml).join('') || `<p class="text-dim">${tHtml('today.soonEmpty')}</p>`;
    enableInfoTooltips(scheduleCard);
    updateProgress();
    // The countdowns tick; once one runs out (a run ended or started) the lists show the new state.
    startCountdowns(scheduleCard, renderSchedule);
}

/** Packages bought per week by the plan: id -> purchases (whole numbers). */
const plannedCounts = () => new Map(valuation.plan.purchases.map((p) => [p.id, Math.round(p.count)]));

/** Today's weekday offers (`weekly_rotation` packs on sale today), best ratio first, with what the plan buys. */
function renderOffers() {
    const weekday = WEEKDAYS[weekdayIndex(renderedDay)];
    const settings = getSettings();
    const rules = { activeEventIds: new Set(settings.activeEvents), seasonalPasses: settings.seasonalPasses };
    const planned = plannedCounts();
    const locale = getLocale();
    const offers = Object.entries(data.packages)
        .filter(
            ([id, pkg]) =>
                pkg.category === 'weekly_rotation' && pkg.available_days?.includes(weekday) && isOnSale(id, pkg, rules),
        )
        .map(([id, pkg]) => ({ id, pkg, ...valuation.bundle(pkg, pkg.price) }));
    // Best ratio first, a pack's tiers together (its best tier places it), the lowest tier first; offers with items of
    // unknown worth (no ratio) last.
    const rank = (offer) => (offer.incomplete ? -1 : (offer.ratio ?? -1));
    const family = (offer) => packageFamilyId(offer.id, offer.pkg);
    const best = new Map();
    for (const offer of offers) {
        best.set(family(offer), Math.max(best.get(family(offer)) ?? -1, rank(offer)));
    }
    offers.sort(
        (a, b) =>
            best.get(family(b)) - best.get(family(a)) ||
            family(a).localeCompare(family(b)) ||
            (a.pkg.tier ?? 0) - (b.pkg.tier ?? 0),
    );
    offersWrap.hidden = offers.length === 0;
    offersEmpty.hidden = offers.length > 0;
    if (offers.length === 0) {
        return;
    }
    const maxRatio = ratioScale(offers.map((o) => o.ratio));
    let previousFamily = null;
    const rows = offers.map((offer) => {
        const { id, pkg, worth, ratio, incomplete } = offer;
        // A higher tier of the pack above it: indented, as a step of its ladder.
        const higherTier = family(offer) === previousFamily;
        previousFamily = family(offer);
        const count = planned.get(id) || 0;
        const icon = packageIcon(pkg);
        const row = gridRow(
            [
                gridCell(
                    `${icon ? itemIconSlot(icon) : ''}${packageDisplayName(pkg, locale)}${requiresIconHtml(pkg.requires, data.packages, data.items, locale)}`,
                    { className: `item-cell${higherTier ? ' offer-tier' : ''}` },
                ),
                gridNum(banknotesAmount(pkg.price)),
                gridNum(banknotesAmount(worth), { wide: true }),
                gridNum(ratioCellHtml(incomplete ? null : ratio, maxRatio)),
                gridNum(count ? buyBadge(`×${formatThousands(count)}`) : ''),
                gridNum(detailsToggleHtml(id, offerExpanded)),
            ],
            { buy: count > 0 },
        );
        return row + offerDetailsHtml(id, offer);
    });
    const header = gridRow([
        gridHeader(tHtml('common.table.pack')),
        gridHeader(tHtml('common.table.price'), { num: true }),
        gridHeader(tHtml('common.table.worth'), { num: true, wide: true }),
        gridHeader(tHtml('common.table.ratio'), { num: true }),
        gridHeader(tHtml('common.table.buy'), { num: true }),
        gridHeader(),
    ]);
    offersTable.innerHTML = gridTable(header, rows.join(''));
    hydrateItemIcons(offersTable);
    enableInfoTooltips(offersTable);
    wireDetailsToggles(offersTable, offerExpanded);
}

/** The Details block of an offer: what it gives, item by item, in the table's columns. */
function offerDetailsHtml(key, bundle) {
    const rows = breakdownParts(bundle.parts, data, valuation).map((part) =>
        packPartRowHtml(part, { limitColumn: false }),
    );
    return gridDetails(key, offerExpanded, rows.join(''));
}

/** "×3 / week", "×1 / month": what the plan buys of a package in the unit its limit counts in. */
function countText(pkg, planned) {
    if (pkg.limit_type === 'monthly' || pkg.limit_type === 'biweekly') {
        const per = pkg.limit_type === 'monthly' ? t('common.perMonth') : t('common.perTwoWeeks');
        return `×${formatThousands(planned)} / ${per}`;
    }
    const perWeek = pkg.limit_type === 'daily' && !pkg.event_id ? ` / ${tHtml('today.week')}` : '';
    return `×${formatThousands(planned)}${perWeek}`;
}

/** The Event Shops' tab of an event, or of a shop without event. */
const shoppingPlanHref = (shopId, shop) =>
    shop.event_id ? eventPlanHref(shop.event_id) : pageHref('events', { event: `shop:${shopId}` });

/** Your weekly plan by when to buy it: daily packs, weekly and longer ones, weekday offers, each event, shops. */
function renderPlan() {
    const plan = valuation.plan;
    const locale = getLocale();
    const grouped = groupPlanByWhen(plan, data, renderedDay);
    const line = (label, value, className = '') =>
        `<li${className ? ` class="${className}"` : ''}><span>${label}</span><span>${value}</span></li>`;
    const entryOf = ({ pkg, planned, spend }) => [
        packageDisplayName(pkg, locale),
        countText(pkg, planned),
        banknotesAmount(spend),
    ];
    const daily = grouped.daily.map(entryOf);
    const weekly = grouped.weekly.map(entryOf);
    const rotation = grouped.rotation.map((offer) => [
        ...entryOf(offer),
        `<span class="text-dim">${escapeHtml(formatDays(offer.pkg.available_days))}</span>`,
        offer.timing,
    ]);
    const { byEvent, standing } = grouped;

    const packList = (entries) =>
        `<ul class="plan-list">${entries
            .map(([name, count, price, days, timing]) =>
                line(
                    `${name} <strong>${count}</strong>${days ? ` ${days}` : ''}`,
                    price,
                    // Not on sale today: dimmed text (still ahead this week), faded (over this week).
                    timing && timing.state !== 'today' ? `plan-list__item--${timing.state}` : '',
                ),
            )
            .join('')}</ul>`;
    const timingOrder = { today: 0, upcoming: 1, past: 2 };
    rotation.sort(
        (a, b) =>
            timingOrder[a[4].state] - timingOrder[b[4].state] || a[4].days - b[4].days || a[0].localeCompare(b[0]),
    );
    const tiles = [];
    for (const [key, entries] of [
        ['daily', daily],
        ['weekly', weekly],
        ['rotation', rotation],
    ]) {
        if (entries.length > 0) {
            tiles.push(tileHtml(tHtml(`today.tiles.${key}`), packList(entries)));
        }
    }
    for (const [eventId, { packs, offers }] of byEvent) {
        const href = eventPlanHref(eventId);
        const offersLine =
            offers > 0
                ? `<div class="plan-stat text-dim">${tHtml('today.shopOffers', { count: formatThousands(Math.round(offers)) })}</div>`
                : '';
        tiles.push(
            tileHtml(
                escapeHtml(localizedName(data.events[eventId].name)),
                `${packs.length > 0 ? packList(packs.map(entryOf)) : ''}${offersLine}<div class="plan-stat"><a href="${href}">${tHtml('today.openPlan')}</a></div>`,
            ),
        );
    }
    if (standing.size > 0) {
        tiles.push(
            tileHtml(
                t('today.tiles.shops'),
                `<ul class="plan-list">${[...standing]
                    .map(([shopId, count]) => {
                        const shop = data.exchange_shops[shopId];
                        const name = escapeHtml(localizedName(shop.name));
                        return line(
                            `<a href="${shoppingPlanHref(shopId, shop)}">${name}</a>`,
                            t('today.shopOffers', { count: formatThousands(Math.round(count)) }),
                        );
                    })
                    .join('')}</ul>`,
            ),
        );
    }
    planSummary.innerHTML = tHtml('today.planSummary', {
        spent: banknotesAmount(plan.spent),
        budget: banknotesAmount(plan.budget),
    });
    planTiles.innerHTML = tiles.join('') || `<p class="text-dim">${tHtml('today.planEmpty')}</p>`;
}

function render() {
    renderSchedule();
    renderOffers();
    renderPlan();
}

startPage('today', {
    async init(loaded) {
        data = loaded;
        const { recompute } = mountValuationPage(data, {
            fields: ['budget', 'events', 'passes'],
            render: (next) => {
                valuation = next;
                render();
            },
        });
        await recompute();
        // A new game day (they start at 02:00 UTC) changes what runs and which weekday offers are on sale; within a
        // day the entries' fill moves on.
        window.setInterval(() => {
            if (gameDay(new Date()).day !== renderedDay) {
                render();
            } else {
                updateProgress();
            }
        }, 60000);
    },
    onLocaleChange: render,
});
