import { startPage } from '../ui/page.js';
import { buildValuation } from '../ui/valuation.js';
import { mountValuationPanel } from '../ui/valuation-panel.js';
import { getSettings, onSettingsChange } from '../ui/settings.js';
import { withLoading } from '../ui/loading.js';
import { banknotesHtml, escapeHtml, hydrateItemIcons, itemIconSlot } from '../ui/html.js';
import { enableInfoTooltips } from '../ui/tooltip.js';
import { infoIconHtml, requiresIconHtml } from '../ui/info-icon.js';
import { packageDisplayName, packageIcon } from '../ui/labels.js';
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
} from '../ui/grid.js';
import { formatDays, getLocale, localizedName, t, tHtml } from '../ui/i18n.js';
import { formatThousands } from '../ui/format.js';
import { ratioBarHtml } from '../ui/ratio-bar.js';
import {
    eventImageUrl,
    countdownText,
    formatGameDay,
    scheduleHref,
    scheduleImage,
    scheduleName,
    slotRangeText,
    startCountdowns,
} from '../ui/event-banner.js';
import { WEEKDAYS, isOnSale, packageWeeklyCapacity } from '../core/catalog.js';
import { packageFamilyId } from '../core/pack-data.js';
import {
    forecastRuns,
    gameDay,
    rotationSlots,
    runMoments,
    scheduleRuns,
    weekdayIndex,
    weekdayOfferTiming,
} from '../core/schedule.js';

// An upcoming entry's fill grows over the last hours before it starts (the same for all, whatever it is).
const SOON_FILL_MS = 4 * 3600000;
// A running entry with less than this left has its countdown in yellow.
const ENDING_MS = 24 * 3600000;
// What starts within this many days is listed under "Starting soon".
const SOON_DAYS = 3;
// The order of the schedule's kinds (as on the Calendar) and their labels.
const KINDS = ['event', 'ingame', 'pass', 'track'];
const KIND_LABELS = {
    event: 'calendar.schedule.groupEvents',
    ingame: 'calendar.schedule.groupIngame',
    pass: 'calendar.schedule.groupPasses',
    track: 'calendar.schedule.groupTracks',
};

const scheduleCard = document.getElementById('schedule-card');
const runningList = document.getElementById('running-list');
const soonList = document.getElementById('soon-list');
const offersWrap = document.getElementById('offers-wrap');
const offersEmpty = document.getElementById('offers-empty');
const offersTable = document.getElementById('offers-table');
const planSummary = document.getElementById('plan-summary');
const planTiles = document.getElementById('plan-tiles');

let data = null;
let settings = null;
let valuation = null;
let panel = null;
// The game day the page shows (a new one renders it all again).
let renderedDay = null;
// The offers' open Details blocks (kept across re-renders).
const offerExpanded = new Set();

const gold = banknotesHtml;

const tileHtml = (label, body) =>
    `<div class="plan-tile"><div class="plan-tile__label">${label}</div><div class="plan-tile__body">${body}</div></div>`;

/**
 * An entry of a list. `start` / `end` are moments (ms).
 * - A run from the schedule (whole game days): the event's, pass's or track's name, its own short line beside it, the
 *   dates (and "expected" for a forecast), a link if it has a page.
 * - A phase of an event rotation (Survival Battle): the phase's name as the title, the event's name beside it, the
 *   slot's times in local time, and (as an info icon) how to earn points in it.
 */
function runEntry(id, kind, run, state, forecast = false) {
    const moments = runMoments(run);
    const range = `${formatGameDay(run.start)} – ${formatGameDay(run.end)}`;
    return {
        id,
        kind,
        state,
        forecast,
        title: scheduleName(data, id),
        // The event's own short line, if it has one (the Demon Kings: which heroes deal more damage).
        description: localizedName(data.events?.[id]?.description),
        image: scheduleImage(data, id),
        href: scheduleHref(data, id, settings.activeEvents),
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
    return tHtml('today.planPacks', { count: formatThousands(mine.length), spent: gold(formatThousands(spent, 0)) });
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
            <span class="today-entry__kind">${escapeHtml(t(KIND_LABELS[entry.kind]))}</span>
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
    const running = [];
    const soon = [];
    for (const [id, { kind, runs }] of scheduleRuns(data, today)) {
        const current = runs.find((run) => run.start <= today && today <= run.end);
        if (current) {
            running.push(runEntry(id, kind, current, 'running', Boolean(current.forecast)));
        }
        // Forecasts only where the pattern has proven itself; a guess would be noise in a list of what's next.
        const upcoming = [
            ...runs.filter((run) => run.start > today),
            ...forecastRuns(runs, { from: today + 1, to: today + SOON_DAYS, today })
                .filter((run) => run.proven)
                .map((run) => ({ ...run, forecast: true })),
        ].filter((run) => run.start > today && run.start <= today + SOON_DAYS);
        for (const run of upcoming) {
            soon.push(runEntry(id, kind, run, 'upcoming', Boolean(run.forecast)));
        }
    }
    const now = Date.now();
    for (const rotation of Object.values(data.event_rotations || {})) {
        const { current, next } = rotationSlots(rotation, now);
        running.push(rotationEntry(rotation, current, 'running'));
        soon.push(rotationEntry(rotation, next, 'upcoming'));
    }
    const order = (a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind);
    // The one ending first on top (the kind only breaks ties).
    running.sort((a, b) => a.end - b.end || order(a, b));
    soon.sort((a, b) => a.start - b.start || order(a, b));
    runningList.innerHTML =
        running.map(entryHtml).join('') || `<p class="text-dim">${escapeHtml(t('today.runningEmpty'))}</p>`;
    soonList.innerHTML = soon.map(entryHtml).join('') || `<p class="text-dim">${escapeHtml(t('today.soonEmpty'))}</p>`;
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
    const maxRatio = Math.max(1, ...offers.map((o) => o.ratio).filter(Number.isFinite));
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
                gridNum(gold(formatThousands(pkg.price, 0))),
                gridNum(gold(formatThousands(worth, 0)), { wide: true }),
                gridNum(incomplete || ratio === null ? t('common.dash') : ratioBarHtml(ratio, maxRatio, { digits: 3 })),
                gridNum(count ? `<span class="buy-badge">×${formatThousands(count)}</span>` : ''),
                gridNum(detailsToggleHtml(id, offerExpanded)),
            ],
            { buy: count > 0 },
        );
        return row + offerDetailsHtml(id, offer);
    });
    const header = gridRow([
        gridHeader(t('events.table.pack')),
        gridHeader(t('events.table.price'), { num: true }),
        gridHeader(t('events.table.worth'), { num: true, wide: true }),
        gridHeader(t('events.table.ratio'), { num: true }),
        gridHeader(t('events.table.buy'), { num: true }),
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
        gridRow([
            gridCell(part.item, { className: 'item-cell' }),
            // On phones the Worth column is hidden: the item's worth moves to the Price column.
            gridNum(`<span class="phone-only">${part.worth}</span>`),
            gridNum(part.worth, { wide: true }),
            gridNum(''),
            gridNum(''),
            gridNum(part.unknown ? `<span class="text-bad">${t('rankings.table.incomplete')}</span>` : ''),
        ]),
    );
    return gridDetails(key, offerExpanded, rows.join(''));
}

/** The purchases a plan line asks for: whole ones, per period for monthly and biweekly packs. */
function plannedPurchases(pkg, count) {
    const periodic = pkg.limit_type === 'monthly' || pkg.limit_type === 'biweekly';
    return Math.max(1, Math.round(periodic ? count / packageWeeklyCapacity(pkg) : count));
}

/** "×3 / week", "×1 / month": what the plan buys of a package in the unit its limit counts in. */
function countText(pkg, planned) {
    if (pkg.limit_type === 'monthly' || pkg.limit_type === 'biweekly') {
        const per = pkg.limit_type === 'monthly' ? t('rankings.perMonth') : t('rankings.perTwoWeeks');
        return `×${formatThousands(planned)} / ${per}`;
    }
    const perWeek = pkg.limit_type === 'daily' && !pkg.event_id ? ` / ${t('today.week')}` : '';
    return `×${formatThousands(planned)}${perWeek}`;
}

/** The Event Shops' tab of an event, or of a shop without event. */
const shoppingPlanHref = (shopId, shop) =>
    `events.html?event=${encodeURIComponent(shop.event_id ? `event:${shop.event_id}` : `shop:${shopId}`)}`;

/** Your weekly plan by when to buy it: daily packs, weekly and longer ones, weekday offers, each event, shops. */
function renderPlan() {
    const plan = valuation.plan;
    const locale = getLocale();
    const daily = [];
    const weekly = [];
    const rotation = [];
    const byEvent = new Map();
    const eventTile = (eventId) => {
        if (!byEvent.has(eventId)) {
            byEvent.set(eventId, { packs: [], offers: 0 });
        }
        return byEvent.get(eventId);
    };
    const line = (label, value, className = '') =>
        `<li${className ? ` class="${className}"` : ''}><span>${label}</span><span>${value}</span></li>`;
    for (const { pkg, count, spend } of plan.purchases) {
        const entry = [
            packageDisplayName(pkg, locale),
            countText(pkg, plannedPurchases(pkg, count)),
            gold(formatThousands(spend, 0)),
        ];
        if (pkg.event_id) {
            eventTile(pkg.event_id).packs.push(entry);
        } else if (pkg.category === 'weekly_rotation') {
            rotation.push([
                ...entry,
                `<span class="text-dim">${escapeHtml(formatDays(pkg.available_days))}</span>`,
                weekdayOfferTiming(pkg.available_days, renderedDay),
            ]);
        } else if (pkg.limit_type === 'daily') {
            daily.push(entry);
        } else {
            weekly.push(entry);
        }
    }
    // Shop offers (how many different ones the plan buys, not how often): of an event's shop in that event's tile,
    // the others (VIP Shop, ...) in one tile of their own.
    const standing = new Map();
    for (const { shopId } of plan.exchanges) {
        const shop = data.exchange_shops[shopId];
        if (shop.event_id) {
            eventTile(shop.event_id).offers += 1;
        } else {
            standing.set(shopId, (standing.get(shopId) || 0) + 1);
        }
    }

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
            tiles.push(tileHtml(t(`today.tiles.${key}`), packList(entries)));
        }
    }
    for (const [eventId, { packs, offers }] of byEvent) {
        const href = `events.html?event=${encodeURIComponent(`event:${eventId}`)}`;
        const offersLine =
            offers > 0
                ? `<div class="plan-stat text-dim">${t('today.shopOffers', { count: formatThousands(Math.round(offers)) })}</div>`
                : '';
        tiles.push(
            tileHtml(
                escapeHtml(localizedName(data.events[eventId].name)),
                `${packs.length > 0 ? packList(packs) : ''}${offersLine}<div class="plan-stat"><a href="${href}">${t('today.openPlan')}</a></div>`,
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
        spent: gold(formatThousands(plan.spent, 0)),
        budget: gold(formatThousands(plan.budget, 0)),
    });
    planTiles.innerHTML = tiles.join('') || `<p class="text-dim">${escapeHtml(t('today.planEmpty'))}</p>`;
}

function render() {
    renderSchedule();
    renderOffers();
    renderPlan();
}

async function recompute() {
    await withLoading(async () => {
        valuation = await buildValuation(data, settings);
        panel.showRate(valuation);
        render();
    });
}

startPage('today', {
    async init(loaded) {
        data = loaded;
        settings = getSettings();
        panel = mountValuationPanel(document.getElementById('valuation-panel'), data, {
            fields: ['budget', 'events', 'passes'],
        });
        onSettingsChange((next) => {
            settings = next;
            recompute();
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
