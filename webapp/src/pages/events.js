import { startPage } from '../ui/page.js';
import { buildValuation, planOptions } from '../ui/valuation.js';
import { solveWeeklyPlan } from '../core/planner.js';
import { mountValuationPanel } from '../ui/valuation-panel.js';
import { getSettings, updateSettings, onSettingsChange, MINE_SAFETY_LEVELS } from '../ui/settings.js';
import { withLoading } from '../ui/loading.js';
import { packageWeeklyCapacity, offerWeeklyCapacity, isOnSale, currencyCost } from '../core/catalog.js';
import { createUnitCounter } from '../core/item-sources.js';
import { urlParam, setUrlParams } from '../ui/url.js';
import { packageDisplayName, itemDisplayName, itemLinkName, bundleLabel } from '../ui/labels.js';
import { banknotesHtml, escapeAttr, escapeHtml, itemIconSlot, hydrateItemIcons } from '../ui/html.js';
import {
    gridCell,
    gridNum,
    gridHeader,
    gridRow,
    gridTable,
    gridSection,
    gridDetails,
    detailsToggleHtml,
    wireDetailsToggles,
    breakdownParts,
} from '../ui/grid.js';
import { enableInfoTooltips } from '../ui/tooltip.js';
import { infoIconHtml } from '../ui/info-icon.js';
import { t, tHtml, getLocale, localizedName } from '../ui/i18n.js';
import { formatThousands, formatSignificant } from '../ui/format.js';
import { ratioBarHtml } from '../ui/ratio-bar.js';
import { targetFloor, expectedDigs, floorsFor, pickaxeOdds, mineSegments, normalRewardBundle } from '../core/mine.js';
import { scheduleRuns, runStatus, forecastRuns, gameDay } from '../core/schedule.js';
import { eventBannerHtml, eventImageUrl, scheduleTiming, startCountdowns } from '../ui/event-banner.js';

// One tab per ticked event and per shop without event (VIP Shop): usually only a few, so one click each.
const eventTabs = document.getElementById('event-tabs');
const chooseEvents = document.getElementById('choose-events');
const exceedLimits = document.getElementById('exceed-limits');
const exceedLimitsInfo = document.getElementById('exceed-limits-info');
const exceedField = document.getElementById('exceed-field');
const extraDiamondsField = document.getElementById('extra-diamonds-field');
const extraDiamondsInput = document.getElementById('extra-diamonds');
const extraBanknotesField = document.getElementById('extra-banknotes-field');
const extraBanknotesInput = document.getElementById('extra-banknotes');
const minePickaxesField = document.getElementById('mine-pickaxes-field');
const minePickaxesInput = document.getElementById('mine-pickaxes');
const mineFloorField = document.getElementById('mine-floor-field');
const mineFloorInput = document.getElementById('mine-floor');
const promptCard = document.getElementById('event-prompt-card');
const planCard = document.getElementById('plan-card');
const eventBanner = document.getElementById('event-banner');
const exceedNote = document.getElementById('exceed-note');
const lockNote = document.getElementById('lock-note');
const eventSummary = document.getElementById('event-summary');
const shopSection = document.getElementById('shop-section');
const shopHeading = document.getElementById('shop-heading');
const shopNote = document.getElementById('shop-note');
const shopTable = document.getElementById('shop-table');
const mineSection = document.getElementById('mine-section');
const mineHeading = document.getElementById('mine-heading');
const mineTable = document.getElementById('mine-table');
const mineRules = document.getElementById('mine-rules');
const stepsCard = document.getElementById('steps-card');
const stepsTable = document.getElementById('steps-table');
const stepsNote = document.getElementById('steps-note');

// Event pack spend levels of the "how much to spend" table (beyond what your plan already spends).
const STEP_LEVELS = [1000, 2000, 5000, 10000, 20000, 50000];

let data = null;
let settings = null;
let valuation = null;
let panel = null;
// The tab shown: `event:<id>` or `shop:<id>` (from the URL first, so a link opens the same event).
let selectedKey = urlParam('event') ?? '';
let stepCache = { key: null, steps: null };
let lockCostCache = { key: null, cost: null };
// The page overrides the shown valuation was solved with (a tab switch re-solves only if they change).
let valuationKey = null;
// The mine table's open Details blocks (kept across re-renders).
const mineExpanded = new Set();
// itemId -> whether any pack or another shop gives it (for the "Only here" badge), per shop.
const otherSourceCache = new Map();

const gold = banknotesHtml;
const iconHtml = itemIconSlot;
const cell = (html, className = '') => gridCell(html, { className });
const numCell = gridNum;
// `wide`: column hidden on phones (Limit, Cost in Banknotes of the shop table).
const WIDE = { wide: true };
const headerCell = (key, num = false, wide = false) => gridHeader(t(`events.table.${key}`), { num, wide });

/**
 * The selection: an event (`event:<id>`, with its shop and mine if any) or a shop without event (`shop:<id>`).
 */
function selection() {
    const [kind, id] = selectedKey.split(':');
    if (kind === 'event' && data.events?.[id]) {
        const shopEntry = Object.entries(data.exchange_shops || {}).find(([, shop]) => shop.event_id === id);
        const mineEntry = Object.entries(data.mines || {}).find(([, mine]) => mine.event_id === id);
        return {
            eventId: id,
            shopId: shopEntry?.[0] ?? null,
            shop: shopEntry?.[1] ?? null,
            mineId: mineEntry?.[0] ?? null,
            mine: mineEntry?.[1] ?? null,
        };
    }
    if (kind === 'shop' && data.exchange_shops?.[id]) {
        return { eventId: null, shopId: id, shop: data.exchange_shops[id] };
    }
    return null;
}

/** Whether the event's pack limits can be exceeded in the game (`exceedable_pack_limits` in the data). */
const isExceedable = (eventId) => Boolean(eventId && data.events?.[eventId]?.exceedable_pack_limits);

/** Whether the box is ticked for this event (remembered per event in the settings). */
const exceedTicked = (eventId) => Boolean(eventId && settings.exceedEventLimits?.includes(eventId));

/** Whether this page lifts the selected event's pack limits: box ticked and the event allows it. */
function exceeding() {
    const eventId = selection()?.eventId;
    return exceedTicked(eventId) && isExceedable(eventId);
}

/** The VIP Shop (a shop without event) is selected: diamonds can also come from outside the packs. */
const isVipShop = (selected) => Boolean(selected?.shop && !selected.shop.event_id);

/** Extra Banknotes per week the user puts only into this event's packs (remembered per event). */
const extraFor = (eventId) => (eventId && settings.extraEventBanknotes?.[eventId]) || 0;

/**
 * The run a mine's inputs are about: the one on now (`days` left, today included), else the next one (all its
 * days; recorded or forecast). `{ state: 'running' | 'next', start, days }`, or null without a schedule.
 */
function mineRun(eventId) {
    const runs = scheduleRuns(data).get(eventId)?.runs || [];
    const today = gameDay(new Date()).day;
    const status = runStatus(runs, today);
    if (status?.state === 'running') {
        return { state: 'running', start: status.run.start, days: status.days + 1 };
    }
    const next =
        status?.state === 'upcoming' ? status.run : forecastRuns(runs, { from: today, to: today + 366, today })[0];
    return next ? { state: 'next', start: next.start, days: next.end - next.start + 1 } : null;
}

/** The pickaxes owned and the floor reached (only for the run it was entered for: the floors start again). */
function mineProgressFor(mineId, run) {
    const stored = settings.mineProgress?.[mineId];
    return {
        owned: stored?.pickaxes || 0,
        floor: stored && run && stored.run === run.start ? stored.floor || 0 : 0,
    };
}

/**
 * Planner options of this page: the selected event's pack limits lifted when exceeding, its extra
 * Banknotes on top of the weekly spend; for the VIP Shop, the extra diamonds per week on top of what
 * the packs give; for a mine, the days left of its run (daily pack limits, free pickaxes), the pickaxes
 * owned, the floor reached and how sure the planned pickaxes should be.
 */
function pageOverrides() {
    const selected = selection();
    const overrides = exceeding() ? { exceedEventPackLimits: new Set([selected.eventId]) } : {};
    if (extraFor(selected?.eventId) > 0) {
        overrides.eventBudget = { eventId: selected.eventId, extra: extraFor(selected.eventId) };
    }
    if (isVipShop(selected) && settings.extraDiamonds > 0) {
        overrides.extraCurrency = { [selected.shop.currency_item_id]: settings.extraDiamonds };
    }
    if (selected?.mine) {
        const run = mineRun(selected.eventId);
        if (run) {
            overrides.eventDaysLeft = { [selected.eventId]: run.days };
        }
        overrides.mineProgress = { [selected.mineId]: mineProgressFor(selected.mineId, run) };
        overrides.mineSafety = settings.minePlanSafety;
    }
    return overrides;
}

/** The page overrides as a string (Sets as arrays), to tell whether the plan has to be solved again. */
const overridesKey = () => JSON.stringify(pageOverrides(), (key, value) => (value instanceof Set ? [...value] : value));

const eventPurchases = (plan, eventId) => plan.purchases.filter((p) => p.pkg.event_id === eventId);
const eventPackSpend = (plan, eventId) => eventPurchases(plan, eventId).reduce((sum, p) => sum + p.spend, 0);

/** Most Banknotes the event's packages can take per week (unlimited with exceeded limits). */
function eventMaxSpend(eventId) {
    const rules = { activeEventIds: new Set([eventId]), eventDaysLeft: pageOverrides().eventDaysLeft };
    const packages = Object.entries(data.packages)
        .filter(
            ([id, pkg]) =>
                pkg.event_id === eventId && isOnSale(id, pkg, rules) && packageWeeklyCapacity(pkg, rules) > 0,
        )
        .map(([, pkg]) => pkg);
    if (exceeding() && packages.length > 0) {
        return Infinity;
    }
    return packages.reduce((sum, pkg) => sum + packageWeeklyCapacity(pkg, rules) * pkg.price, 0);
}

/** Price of the event's cheapest pack (whole packs rarely hit a spend level exactly). */
function cheapestEventPack(eventId) {
    const prices = Object.entries(data.packages)
        .filter(([id, pkg]) => pkg.event_id === eventId && isOnSale(id, pkg))
        .map(([, pkg]) => pkg.price);
    return prices.length > 0 ? Math.min(...prices) : 0;
}

/**
 * How much spending on the event is worth it: the weekly plan re-solved with the event's pack spend
 * at 0, at your plan's own spend E₀ and at round levels above it, the rest of your weekly spend
 * unchanged (budget = weekly spend + the event's extra Banknotes − E₀ + level). Step ratio = the step's extra points (in Banknotes
 * at your weekly spend) ÷ its extra Banknotes: at least 1 = still as good as your last Banknote.
 * Above E₀ a level only has to be reached within one cheapest pack (whole packs rarely hit it
 * exactly); levels the event can't reach, or that change nothing, are left out.
 */
function stepAnalysis(eventId) {
    const base = valuation.plan;
    const e0 = eventPackSpend(base, eventId);
    const max = eventMaxSpend(eventId);
    const levels = [...new Set([0, e0, ...STEP_LEVELS.filter((level) => level > e0 && level <= max)])].sort(
        (a, b) => a - b,
    );
    const slack = cheapestEventPack(eventId) - 1;
    const solveLevel = (level) => {
        if (level === e0) {
            return base;
        }
        try {
            return solveWeeklyPlan(
                valuation.highs,
                data,
                planOptions(data, settings, {
                    ...pageOverrides(),
                    // The level pins the event's spend; the extra Banknotes are part of the total here.
                    eventBudget: null,
                    budget: settings.budget + extraFor(eventId) - e0 + level,
                    eventSpend: level < e0 ? { eventId, max: level } : { eventId, min: Math.max(e0, level - slack) },
                }),
            );
        } catch {
            return null; // level out of reach
        }
    };
    let previous = null;
    const steps = [];
    for (const level of levels) {
        const plan = solveLevel(level);
        if (!plan || (previous && eventPackSpend(plan, eventId) === eventPackSpend(previous, eventId))) {
            continue;
        }
        const step = {
            isPlan: level === e0,
            eventSpend: eventPackSpend(plan, eventId),
            packs: eventPurchases(plan, eventId).map((p) => ({ pkg: p.pkg, count: p.count })),
            stepCost: previous ? plan.spent - previous.spent : null,
            stepWorth: previous ? (plan.totalPoints - previous.totalPoints) / valuation.rate : null,
        };
        step.ratio = step.stepCost > 0 ? step.stepWorth / step.stepCost : null;
        previous = plan;
        steps.push(step);
    }
    return steps;
}

const tileHtml = (label, body, wide = false) =>
    `<div class="plan-tile${wide ? ' plan-tile--wide' : ''}"><div class="plan-tile__label">${label}</div><div class="plan-tile__body">${body}</div></div>`;

/**
 * A currency's tile: received from the packs (the event's packs one by one, so the total adds up), from
 * elsewhere (the page's extra amount) and spent (`spentKey`: where).
 */
function currencyTile(currencyId, spentKey, { eventId = null } = {}) {
    const locale = getLocale();
    const coin = valuation.plan.currencies.get(currencyId);
    const received = coin?.received ?? 0;
    const line = (label, qty) => `<li><span>${label}</span><span>${formatThousands(qty, 0)}</span></li>`;
    const packLines = eventPurchases(valuation.plan, eventId)
        .filter((p) => p.pkg.contains?.[currencyId] > 0)
        .map((p) => [
            `${packageDisplayName(p.pkg, locale)} ×${formatThousands(p.count)}`,
            p.count * p.pkg.contains[currencyId],
        ]);
    // Received otherwise: other packs, nested contents, shop bonus tiers, spend reward tracks.
    const rest = received - packLines.reduce((sum, [, qty]) => sum + qty, 0);
    if (packLines.length > 0 && rest > 0.5) {
        packLines.push([t('events.otherSources'), rest]);
    }
    return tileHtml(
        itemDisplayName(data.items, currencyId, locale),
        `<div class="plan-stat">${iconHtml(currencyId)}<strong>${formatThousands(received, 0)}</strong> ${t('events.received')}</div>
        ${packLines.length > 0 ? `<ul class="plan-list">${packLines.map(([label, qty]) => line(label, qty)).join('')}</ul>` : ''}
        ${coin?.extra ? `<div class="plan-stat">+ <strong>${formatThousands(coin.extra, 0)}</strong> ${t('events.extra')}</div>` : ''}
        <div class="plan-stat text-dim">${formatThousands(coin?.spent ?? 0, 0)} ${t(spentKey)}</div>`,
    );
}

/** "Your plan": one tile per step — the mine's verdict, packs to buy, coins, pickaxes, Encounters, bonus tiers. */
function renderSummary({ eventId, shopId, shop, mineId, mine }) {
    const locale = getLocale();
    const plan = valuation.plan;
    const tiles = [];
    // A mine's verdict (dig this run or not) comes first: everything else follows from it.
    const dug = mine ? minePlan(mineId) : null;
    if (dug) {
        tiles.push(mineVerdictTile(dug));
    }
    if (eventId) {
        const purchases = eventPurchases(plan, eventId);
        // The event's extra Banknotes: how many the plan uses (only where they're worth it, so maybe none).
        const extraNote =
            extraFor(eventId) > 0
                ? `<div class="plan-tile__note text-dim">${t('events.extraBanknotesNote', {
                      used: formatThousands(plan.eventExtraUsed, 0),
                      amount: formatThousands(extraFor(eventId), 0),
                  })}</div>`
                : '';
        const body =
            purchases.length > 0
                ? `<ul class="plan-list">${purchases
                      .map(
                          (p) =>
                              `<li><span>${packageDisplayName(p.pkg, locale)} <strong>×${formatThousands(p.count)}</strong></span><span>${gold(formatThousands(p.spend, 0))}</span></li>`,
                      )
                      .join('')}</ul>${
                      purchases.length > 1
                          ? `<div class="plan-tile__total">${t('events.total')} ${gold(formatThousands(eventPackSpend(plan, eventId), 0))}</div>`
                          : ''
                  }${extraNote}`
                : `<span class="text-dim">${t('events.summaryNoPacks')}</span>${extraNote}`;
        tiles.push(tileHtml(t('events.tiles.packs'), body));
    }
    if (shop) {
        tiles.push(currencyTile(shop.currency_item_id, 'events.spentInShop', { eventId }));
        const pointPurchase = plan.pointPurchases.find((p) => p.shopId === shopId);
        if (shop.point_purchase && pointPurchase) {
            const { currency_item_id: currencyId, currency_cost: cost, points } = shop.point_purchase;
            tiles.push(
                tileHtml(
                    t('events.tiles.encounters'),
                    `<div class="plan-stat"><strong>×${formatThousands(pointPurchase.count)}</strong> = ${iconHtml(currencyId)}<strong class="${currencyId === 'diamonds' ? 'text-diamond' : ''}">${formatThousands(pointPurchase.count * cost)}</strong></div>
                    <div class="plan-stat text-dim">+${formatThousands(pointPurchase.count * points)} ${t('events.points')}</div>`,
                ),
            );
        }
        const thresholds = Object.keys(shop.bonus_tiers || {})
            .map(Number)
            .sort((a, b) => a - b);
        if (thresholds.length > 0) {
            const reached = new Set(
                plan.tiersReached.filter((tier) => tier.shopId === shopId).map((tier) => tier.threshold),
            );
            tiles.push(
                tileHtml(
                    t('events.tiles.bonusTiers'),
                    `<div class="chip-row">${thresholds
                        .map((x) => {
                            // Tooltip: what the tier gives (names are already HTML-escaped).
                            const tip = escapeAttr(bundleLabel(shop.bonus_tiers[String(x)], data.items, locale));
                            return `<span class="chip${reached.has(x) ? ' chip--on' : ''}" tabindex="0" data-tooltip="${tip}" aria-label="${tip}">${reached.has(x) ? '✓ ' : ''}${formatThousands(x)}</span>`;
                        })
                        .join('')}</div>`,
                    true,
                ),
            );
        }
    }
    if (dug) {
        tiles.push(pickaxeTile(dug, eventId));
    }
    const totals = itemTotals({ eventId, shopId, shop, mineId, mine });
    if (totals.length > 0) {
        const totalWorth = totals.reduce((sum, item) => sum + item.worth, 0);
        tiles.push(
            tileHtml(
                t('events.tiles.everything'),
                `<ul class="item-list">${totals
                    .map(
                        ({ id, qty, worth }) =>
                            `<li><span class="item-chip">${iconHtml(id)}${itemLinkName(data.items, id, locale)}</span><strong class="${qty < 0 ? 'text-bad' : ''}">${qty < 0 ? '−' : '×'}${Number.isInteger(qty) ? formatThousands(Math.abs(qty)) : formatSignificant(Math.abs(qty))}</strong><span>${gold(formatThousands(worth, 0))}</span></li>`,
                    )
                    .join('')}</ul>
                <div class="plan-tile__total">${t('events.totalWorth')} ${gold(formatThousands(totalWorth, 0))}</div>`,
                true,
            ),
        );
    }
    eventSummary.innerHTML = tiles.join('');
    hydrateItemIcons(eventSummary);
    enableInfoTooltips(eventSummary);
}

/**
 * Every item the plan gets from the event: the bought packs' contents (incl. the picked choice
 * options), the shop offers bought and the bonus tiers reached, minus what Encounters cost (diamonds),
 * and the mine's expected loot, wishes and progress rewards. The shop's coins and the mine's pickaxes are
 * left out (they're spent there). Sorted by worth.
 */
function itemTotals({ eventId, shopId, shop, mineId, mine }) {
    const plan = valuation.plan;
    const totals = new Map();
    const add = (id, qty) => totals.set(id, (totals.get(id) || 0) + qty);
    if (eventId) {
        for (const p of eventPurchases(plan, eventId)) {
            for (const part of valuation.bundle(p.pkg, 0).parts) {
                add(part.id, part.qty * p.count);
            }
        }
    }
    if (shop) {
        for (const e of plan.exchanges.filter((x) => x.shopId === shopId)) {
            add(e.offer.item_id, e.offer.quantity * e.count);
        }
        for (const tier of plan.tiersReached.filter((x) => x.shopId === shopId)) {
            for (const [id, qty] of Object.entries(tier.reward)) {
                add(id, qty);
            }
        }
        const pointPurchase = plan.pointPurchases.find((p) => p.shopId === shopId);
        if (shop.point_purchase && pointPurchase) {
            add(shop.point_purchase.currency_item_id, -pointPurchase.count * shop.point_purchase.currency_cost);
        }
        totals.delete(shop.currency_item_id);
    }
    const dug = mine ? minePlan(mineId) : null;
    if (dug) {
        const bundles = [
            dug.normalRewards,
            ...dug.wishes.flatMap(({ reward, count }) =>
                count > 0 ? [Object.fromEntries(Object.entries(reward).map(([id, qty]) => [id, qty * count]))] : [],
            ),
            ...dug.progressReached.map((floor) => mine.progress_rewards[String(floor)]),
        ];
        for (const bundle of bundles) {
            for (const [id, qty] of Object.entries(bundle)) {
                add(id, qty);
            }
        }
        totals.delete(mine.currency_item_id);
    }
    return [...totals]
        .filter(([, qty]) => Math.abs(qty) > 1e-9)
        .map(([id, qty]) => ({ id, qty, worth: qty * (valuation.worth(id) ?? 0) }))
        .sort((a, b) => b.worth - a.worth);
}

/** Shop offers grouped by unlock stage (unlock amount once per group); rows the plan buys stand out. */
function renderShop({ shopId, shop }) {
    shopSection.hidden = !shop;
    if (!shop) {
        return;
    }
    const locale = getLocale();
    const plan = valuation.plan;
    const coinWorth = valuation.worth(shop.currency_item_id);
    shopHeading.textContent = localizedName(shop.name, locale);
    shopNote.hidden = !shop.random_offers;
    const bought = new Map(plan.exchanges.filter((e) => e.shopId === shopId).map((e) => [e.offerKey, e.count]));
    const offers = Object.entries(shop.offers || {}).map(([offerKey, offer]) => {
        const b = valuation.bundle({ contains: { [offer.item_id]: offer.quantity } }, 0);
        return {
            offerKey,
            offer,
            count: bought.get(offerKey) || 0,
            worth: b.worth,
            ratio: coinWorth > 0 && !b.incomplete ? b.worth / (offer.currency_cost * coinWorth) : null,
        };
    });
    const maxRatio = Math.max(1, ...offers.map((o) => o.ratio).filter(Number.isFinite));
    // Banknote amounts: whole numbers for event shops; the VIP Shop's are small, so 1 decimal (2 below 1).
    const smallest = Math.min(
        ...offers.flatMap((o) => [o.worth, o.offer.currency_cost * coinWorth]).filter((x) => x > 0),
    );
    const decimals = shop.event_id ? 0 : smallest < 1 ? 2 : 1;
    const bn = (value) => gold(formatThousands(value, decimals));
    const stages = [...new Set(offers.map((o) => o.offer.unlock_points || 0))].sort((a, b) => a - b);
    const coinIcon = iconHtml(shop.currency_item_id);
    const buyBadge = (text) => `<span class="buy-badge">${text}</span>`;
    // Random offers (Recluse Merchant): no weekly count, just whether an offer is worth its coins when it shows up.
    const worthBuying = (o) => (shop.random_offers ? o.ratio >= 1 : o.count > 0);
    const buyCell = (o) => {
        if (shop.random_offers) {
            return o.ratio === null
                ? ''
                : o.ratio >= 1
                  ? buyBadge(t('events.buy'))
                  : `<span class="text-dim">${t('events.skip')}</span>`;
        }
        return o.count ? buyBadge(`×${formatThousands(o.count)}`) : '';
    };

    // Most purchases per week (daily limits also shown per day, e.g. "7 (1/day)").
    const limitHtml = (offer) => {
        const perWeek = formatThousands(offerWeeklyCapacity(offer, shop));
        return offer.limit_type === 'daily'
            ? `${perWeek}&nbsp;<span class="text-dim">(${t('events.perDay', { count: formatThousands(offer.purchase_limit) })})</span>`
            : perWeek;
    };
    // "Must buy" locks (not for random offers, which can't be planned).
    const lockable = !shop.random_offers;
    const lockCell = (offerKey, offer) => {
        const key = `${shopId}:${offerKey}`;
        const isFixed = key in (settings.lockedOffers || {});
        const count = isFixed ? settings.lockedOffers[key] : 0;
        const limit = offerWeeklyCapacity(offer, shop);
        const toggle = `<button type="button" class="lock-toggle" data-lock="${offerKey}" aria-pressed="${isFixed}" title="${t('events.lock')}" aria-label="${t('events.lock')}">${isFixed ? '🔒' : '🔓'}</button>`;
        const amount = isFixed
            ? `<input type="number" class="lock-count" data-lock-count="${offerKey}" min="0" max="${limit}" step="1" value="${Math.min(count, limit)}" title="${t('events.lockCount')}" aria-label="${t('events.lockCount')}" />`
            : '';
        // Count first, lock on the right; right-aligned like the other number columns.
        return numCell(`<span class="lock-cell">${amount}${toggle}</span>`);
    };
    const onlyHereBadge = (offer) =>
        hasOtherSource(shopId, offer.item_id)
            ? ''
            : ` <span class="only-here" title="${t('events.onlyHereHint')}">${t('events.onlyHere')}</span>`;

    const groups = stages.map((stage) => {
        const heading =
            stages.length > 1
                ? gridSection(
                      stage > 0 ? t('events.unlockAt', { points: formatThousands(stage) }) : t('events.unlockStart'),
                  )
                : '';
        const rows = offers
            .filter((o) => (o.offer.unlock_points || 0) === stage)
            .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
            .map(({ offerKey, offer, count, worth, ratio }) =>
                gridRow(
                    [
                        cell(
                            `${iconHtml(offer.item_id)}${itemLinkName(data.items, offer.item_id, locale)} ×${formatThousands(offer.quantity)}${onlyHereBadge(offer)}`,
                            'item-cell',
                        ),
                        numCell(limitHtml(offer), WIDE),
                        numCell(`${formatThousands(offer.currency_cost)} ${coinIcon}`),
                        numCell(coinWorth > 0 ? bn(offer.currency_cost * coinWorth) : t('common.dash'), WIDE),
                        numCell(bn(worth)),
                        numCell(ratio === null ? t('common.dash') : ratioBarHtml(ratio, maxRatio, { digits: 3 })),
                        lockable ? lockCell(offerKey, offer) : '',
                        numCell(buyCell({ count, ratio })),
                    ],
                    { buy: worthBuying({ count, ratio }) },
                ),
            );
        return heading + rows.join('');
    });

    const reached = new Set(plan.tiersReached.filter((tier) => tier.shopId === shopId).map((tier) => tier.threshold));
    const tierRows = Object.keys(shop.bonus_tiers || {})
        .map(Number)
        .sort((a, b) => a - b)
        .map((threshold) => {
            const reward = shop.bonus_tiers[String(threshold)];
            const b = valuation.bundle({ contains: reward }, 0);
            const firstItem = Object.keys(reward)[0];
            return gridRow(
                [
                    cell(
                        `${iconHtml(firstItem)}${t('events.bonusTier', { threshold: formatThousands(threshold) })}: ${bundleLabel(reward, data.items, locale)}`,
                        'item-cell',
                    ),
                    numCell(t('common.dash'), WIDE),
                    numCell(t('common.dash')),
                    numCell(t('common.dash'), WIDE),
                    numCell(bn(b.worth)),
                    numCell(''),
                    lockable ? numCell('') : '',
                    numCell(reached.has(threshold) ? buyBadge(`✓ ${t('events.reached')}`) : ''),
                ],
                { buy: reached.has(threshold) },
            );
        });

    const header = gridRow([
        headerCell('offer'),
        headerCell('limit', true, true),
        headerCell('cost', true),
        headerCell('costBanknotes', true, true),
        headerCell('worth', true),
        headerCell('ratio', true),
        lockable ? headerCell('mustBuy', true) : '',
        headerCell(shop.random_offers ? 'buyIfOffered' : 'buy', true),
    ]);
    shopTable.innerHTML = gridTable(
        header,
        `${groups.join('')}${tierRows.length > 0 ? `${gridSection(t('events.bonusSection'))}${tierRows.join('')}` : ''}`,
    );
    shopTable.classList.toggle('events-shop-grid--locks', lockable);
    hydrateItemIcons(shopTable);
    enableInfoTooltips(shopTable);
    wireLocks(shopId, shop);
}

/** The mine's part of the plan (`plan.mines`), or null. */
const minePlan = (mineId) => valuation.plan.mines.find((m) => m.mineId === mineId) ?? null;

/** Percent of the way through the mine's floors (the floor track, 0 = before floor 1). */
const floorPercent = (mine, floor) =>
    `${((100 * Math.min(Math.max(floor, 0), mine.floors)) / mine.floors).toFixed(2)}%`;

/**
 * What the mine's floors cost and give from the floor reached: one row per stretch up to a progress reward
 * (worth = a wish per floor (the best for you), the normal loot and the progress reward; cost = what its
 * pickaxes cost in the packs on sale, floor by floor from the bottom: the owned and free pickaxes first, then
 * the cheapest pack per pickaxe within the limits of the days left, whole pack prices (see currencyCost), else
 * at their worth). The floors above the target floor follow (`segment.aboveTarget`: never dug, no progress reward). Also the pickaxes this run (`have`: owned, free, from the plan's packs), what the target
 * floor needs (on average, and `odds`: how safe that is, see pickaxeOdds) and what the packs could still give.
 */
function mineEconomics(dug) {
    const { mine } = dug;
    const pickaxeWorth = valuation.worth(mine.currency_item_id);
    const wishWorths = mine.wish_rewards.map((reward) => valuation.bundle({ contains: reward }, 0).worth);
    const bestWish = Math.max(0, ...wishWorths);
    const packCost = (bought) =>
        currencyCost(data.packages, mine.currency_item_id, bought, {
            activeEventIds: new Set(settings.activeEvents),
            seasonalPasses: settings.seasonalPasses,
            exceedEventPackLimits: exceeding() ? new Set([mine.event_id]) : null,
            eventDaysLeft: pageOverrides().eventDaysLeft,
        });
    // Banknotes for the first `pickaxes` pickaxes from the floor reached (the owned and free ones cost nothing).
    const costUpTo = (pickaxes) => {
        const bought = Math.max(0, pickaxes - dug.owned - dug.free.total);
        const cost = packCost(bought);
        return cost ? cost.banknotes : bought * pickaxeWorth;
    };
    // The floors above the target floor: listed with their worth and ratio, but never dug (planner.js).
    const above =
        dug.target > 0
            ? mineSegments(mine, Math.max(dug.startFloor, dug.target)).map((segment) => ({
                  ...segment,
                  cleared: 0,
                  aboveTarget: true,
              }))
            : [];
    let pickaxesBelow = 0;
    const rows = [...dug.segments, ...above].map((segment) => {
        const loot = valuation.bundle({ contains: normalRewardBundle(mine, segment.normalDigs) }, 0).worth;
        const reward = segment.reward ? valuation.bundle({ contains: segment.reward }, 0).worth : 0;
        const worth = loot + segment.floors * bestWish + reward;
        const cost = costUpTo(pickaxesBelow + segment.pickaxes) - costUpTo(pickaxesBelow);
        pickaxesBelow += segment.pickaxes;
        return { segment, worth, cost, ratio: cost > 0 ? worth / cost : null };
    });
    const toTarget = rows.filter(({ segment }) => segment.to <= dug.target);
    const coin = valuation.plan.currencies.get(mine.currency_item_id);
    const have = (coin?.received ?? 0) + (coin?.extra ?? 0);
    const needed = toTarget.reduce((sum, { segment }) => sum + segment.pickaxes, 0);
    return {
        rows,
        wishWorths,
        have,
        odds: dug.target > dug.startFloor ? pickaxeOdds(mine, dug.startFloor + 1, dug.target) : null,
        fromPacks: coin?.received ?? 0,
        spent: coin?.spent ?? 0,
        needed,
        worthToTarget: toTarget.reduce((sum, row) => sum + row.worth, 0),
        costToTarget: costUpTo(needed) - costUpTo(have),
        // Most pickaxes the packs give this run within their limits for the days left.
        available: packCost(0)?.available ?? 0,
    };
}

/** A key number of the verdict card: label above, value below. */
const statHtml = (label, value, className = '') =>
    `<div class="mine-stat"><div class="mine-stat__label">${label}</div><div class="mine-stat__value ${className}">${value}</div></div>`;

/**
 * How sure to be about the pickaxes for the target floor (the digs are random): the average, 9 in 10, 99 in 100
 * or every run (the worst case: every floor only at its pity), each with its pickaxes. The choice is what the
 * plan counts with (`minePlanSafety` in the settings; the change is wired in init).
 */
function mineSafetyHtml(dug, econ) {
    const icon = iconHtml(dug.mine.currency_item_id);
    const keys = { 0.5: 'average', 0.9: 'p90', 0.99: 'p99', 1: 'max' };
    const options = MINE_SAFETY_LEVELS.map((level) => {
        let pickaxes = econ.odds.atLeast(level);
        if (level === 0.5) {
            pickaxes = econ.odds.mean;
        } else if (level >= 1) {
            pickaxes = econ.odds.max;
        }
        const on = settings.minePlanSafety === level;
        return `<label class="mine-safety__option${on ? ' mine-safety__option--on' : ''}">
            <input type="radio" name="mine-safety" value="${level}" ${on ? 'checked' : ''} />
            <span class="mine-safety__amount">${icon}${level === 0.5 ? '≈' : ''}${formatThousands(pickaxes, 0)}</span>
            <span class="mine-safety__label">${escapeHtml(t(`events.mineSafety.${keys[level]}`))}</span>
        </label>`;
    });
    return `<fieldset class="mine-safety">
        <legend>${escapeHtml(
            t('events.mineSafety.title', {
                target: formatThousands(dug.target),
                from: formatThousands(dug.startFloor + 1),
            }),
        )}</legend>
        <div class="mine-safety__options">${options.join('')}</div>
    </fieldset>`;
}

/**
 * The chance the pickaxes this run are enough for the target floor (the luck of the digs, see pickaxeOdds): green
 * from 9 in 10 on, amber from 1 in 2, else red.
 */
function chanceStat(econ) {
    const chance = econ.odds.chanceEnough(econ.have);
    const tone = chance >= 0.9 ? 'text-good' : chance >= 0.5 ? 'text-warn' : 'text-bad';
    let shown = formatThousands(100 * chance, 0);
    if (chance > 0.995 && chance < 1) {
        shown = '> 99';
    } else if (chance < 0.005 && chance > 0) {
        shown = '< 1';
    }
    return statHtml(t('events.mineStat.chance'), `${shown}%`, tone);
}

/**
 * The floor track: floors 0..top as a bar. The floors cleared before (dim), this run's floors (green: the plan
 * digs them) or how far the pickaxes would reach (amber, striped: not dug), a tick per progress reward
 * (green once reached, the reward in the tooltip) and the target floor marked. Below: the scale and a legend.
 */
function floorTrackHtml(dug, reachFloor) {
    const { mine } = dug;
    const locale = getLocale();
    const reached = new Set(dug.progressReached);
    const runEnd = dug.digs ? dug.floorReached : reachFloor;
    const ticks = Object.keys(mine.progress_rewards || {})
        .map(Number)
        .filter((floor) => floor <= mine.floors)
        .sort((a, b) => a - b)
        .map((floor) => {
            const tip = escapeAttr(
                `${t('events.mineTrack.floor', { floor: formatThousands(floor) })}: ${bundleLabel(mine.progress_rewards[String(floor)], data.items, locale)}`,
            );
            const on = reached.has(floor) || floor <= dug.startFloor;
            return `<span class="floor-track__tick${on ? ' floor-track__tick--on' : ''}${floor === dug.target ? ' floor-track__tick--target' : ''}" style="left: ${floorPercent(mine, floor)}" tabindex="0" data-tooltip="${tip}" aria-label="${tip}"></span>`;
        })
        .join('');
    const legend = [
        dug.startFloor > 0
            ? `<span class="floor-track__key floor-track__key--before">${t('events.mineTrack.before', { floor: formatThousands(dug.startFloor) })}</span>`
            : '',
        runEnd > dug.startFloor
            ? `<span class="floor-track__key floor-track__key--${dug.digs ? 'dig' : 'reach'}">${t(
                  dug.digs ? 'events.mineTrack.dig' : 'events.mineTrack.reach',
                  { from: formatThousands(dug.startFloor + 1), to: formatThousands(runEnd) },
              )}</span>`
            : '',
        `<span class="floor-track__key floor-track__key--tick">${t('events.mineTrack.rewards')}</span>`,
    ].join('');
    return `<div class="floor-track">
        <div class="floor-track__bar">
            <span class="floor-track__before" style="width: ${floorPercent(mine, dug.startFloor)}"></span>
            <span class="floor-track__run floor-track__run--${dug.digs ? 'dig' : 'reach'}" style="left: ${floorPercent(mine, dug.startFloor)}; width: calc(${floorPercent(mine, runEnd)} - ${floorPercent(mine, dug.startFloor)})"></span>
            ${ticks}
        </div>
        <div class="floor-track__scale">
            <span style="left: 0">0</span>
            ${dug.target > 0 ? `<span class="floor-track__scale-target" style="left: ${floorPercent(mine, dug.target)}">${formatThousands(dug.target)}</span>` : ''}
            <span style="left: 100%">${formatThousands(mine.floors)}</span>
        </div>
        <div class="floor-track__legend">${legend}</div>
    </div>`;
}

/**
 * The verdict card on top of the plan: dig this run or not. Unused pickaxes carry over, the floors don't, so
 * the plan only digs a run that reaches the last progress reward (planner.js). Then the floor track and the key
 * numbers: what the run digs, or why not (the pickaxes missing and what they'd cost and give; more than the
 * weekly spend; or more than the packs can give in the days left).
 */
function mineVerdictTile(dug) {
    const { mine } = dug;
    const econ = mineEconomics(dug);
    const amount = (value) => formatThousands(value, 0);
    const icon = iconHtml(mine.currency_item_id);
    const target = amount(dug.target);
    // Past the target floor nothing is dug any more: no "would reach" bar either.
    const reachFloor =
        dug.startFloor >= dug.target ? dug.startFloor : dug.startFloor + floorsFor(mine, dug.startFloor, econ.have);
    const left = Math.max(0, econ.have - econ.spent);
    let state;
    let verdict;
    let text; // HTML (tHtml)
    let stats;
    if (dug.digs) {
        state = 'dig';
        verdict = t('events.mineDig');
        text = tHtml('events.mineDigText', { target, reached: amount(dug.floorReached) });
        stats = [
            statHtml(
                t('events.mineStat.floors'),
                `${amount(dug.startFloor + 1)} → ${amount(dug.floorReached)}`,
                'text-good',
            ),
            statHtml(t('events.mineStat.pickaxes'), `${icon}≈${amount(dug.pickaxes)}`),
            statHtml(t('events.mineStat.have'), `${icon}${amount(econ.have)}`),
            chanceStat(econ),
            statHtml(t('events.mineStat.left'), `${icon}${amount(left)}`),
        ];
    } else if (dug.startFloor >= dug.target) {
        state = 'save';
        verdict = t('events.mineStop');
        text = tHtml('events.mineStopPast', { target });
        stats = [
            statHtml(t('events.mineStat.reached'), amount(dug.startFloor), 'text-good'),
            statHtml(t('events.mineStat.left'), `${icon}${amount(left)}`),
        ];
    } else {
        state = 'save';
        verdict = t('events.mineSave');
        const spend = settings.budget + extraFor(mine.event_id);
        const unreachable = econ.needed > dug.owned + dug.free.total + econ.available;
        if (unreachable) {
            text = tHtml('events.mineSaveUnreachable', { target, available: amount(econ.available) });
        } else if (econ.costToTarget > spend) {
            text = tHtml('events.mineSaveBudget', { target, budget: gold(amount(spend)) });
        } else {
            text = tHtml('events.mineSaveText', { target });
        }
        stats = [
            statHtml(t('events.mineStat.needed', { target }), `${icon}≈${amount(econ.needed)}`),
            statHtml(t('events.mineStat.have'), `${icon}${amount(econ.have)}`),
            chanceStat(econ),
            statHtml(
                t('events.mineStat.missing'),
                `${icon}≈${amount(Math.max(0, econ.needed - econ.have))}`,
                'text-warn',
            ),
            unreachable
                ? statHtml(t('events.mineStat.available'), `${icon}${amount(econ.available)}`, 'text-bad')
                : statHtml(t('events.mineStat.cost'), gold(amount(econ.costToTarget))),
            statHtml(t('events.mineStat.worth', { target }), gold(amount(econ.worthToTarget))),
        ];
    }
    return `<div class="plan-tile plan-tile--wide mine-verdict mine-verdict--${state}">
        <div class="mine-verdict__head">
            <span class="mine-verdict__badge" aria-hidden="true">${state === 'dig' ? icon : '✋'}</span>
            <div>
                <div class="mine-verdict__title">${escapeHtml(verdict)}</div>
                <div class="mine-verdict__text">${text}</div>
            </div>
        </div>
        ${floorTrackHtml(dug, reachFloor)}
        <div class="mine-stats">${stats.join('')}</div>
        ${econ.odds ? mineSafetyHtml(dug, econ) : ''}
    </div>`;
}

/**
 * The pickaxe tile: this run's pickaxes as a bar by source (owned, free, purchase bonus, the event's packs) with
 * a mark at what the target floor needs, a legend with the amounts (each pack on its own line), and what's spent
 * digging and left for the next run.
 */
function pickaxeTile(dug, eventId) {
    const locale = getLocale();
    const { mine, free, owned } = dug;
    const econ = mineEconomics(dug);
    const run = mineRun(mine.event_id);
    const days = formatThousands(free.days);
    const packs = eventPurchases(valuation.plan, eventId)
        .filter((p) => p.pkg.contains?.[mine.currency_item_id] > 0)
        .map(
            (p) =>
                `<li><span>${packageDisplayName(p.pkg, locale)} ×${formatThousands(p.count)}</span><span>${formatThousands(p.count * p.pkg.contains[mine.currency_item_id], 0)}</span></li>`,
        );
    const sources = [
        { key: 'owned', label: t('events.mineOwned'), qty: owned },
        {
            key: 'free',
            label: t(run?.state === 'next' ? 'events.mineFreeNext' : 'events.mineFreeLeft', {
                perDay: formatThousands(free.perDay),
                days,
            }),
            qty: free.perDay * free.days,
        },
        {
            key: 'bonus',
            label: t('events.mineBonus', { perDay: formatThousands(free.bonusPerDay), days }),
            qty: free.bonusPerDay * free.days,
        },
        { key: 'packs', label: t('events.minePacks'), qty: econ.fromPacks },
    ].filter((source) => source.qty > 0.5);
    const total = sources.reduce((sum, source) => sum + source.qty, 0);
    const needed = dug.startFloor < dug.target ? econ.needed : 0;
    const scale = Math.max(total, needed, 1);
    const percent = (qty) => `${((100 * qty) / scale).toFixed(2)}%`;
    const bar = `<div class="pick-bar">${sources
        .map(
            (source) =>
                `<span class="pick-bar__part pick-bar__part--${source.key}" style="width: ${percent(source.qty)}"></span>`,
        )
        .join('')}${
        needed > 0
            ? `<span class="pick-bar__mark${total >= needed ? ' pick-bar__mark--met' : ''}" style="left: ${percent(needed)}"></span>`
            : ''
    }</div>`;
    const markLabel =
        needed > 0
            ? `<div class="pick-bar__caption">${t('events.mineNeedMark', {
                  target: formatThousands(dug.target),
                  count: formatThousands(needed, 0),
              })}</div>`
            : '';
    const legend = `<ul class="pick-legend">${sources
        .map(
            (source) =>
                `<li><span class="pick-legend__dot pick-legend__dot--${source.key}"></span><span>${escapeHtml(source.label)}</span><strong>${formatThousands(source.qty, 0)}</strong></li>${
                    source.key === 'packs' && packs.length > 0
                        ? `<li class="pick-legend__packs"><ul class="plan-list">${packs.join('')}</ul></li>`
                        : ''
                }`,
        )
        .join('')}</ul>`;
    const noBonus =
        mine.purchase_bonus_per_day > 0 && free.bonusPerDay === 0
            ? `<div class="plan-tile__note text-dim">${t('events.mineNoBonus', {
                  perDay: formatThousands(mine.purchase_bonus_per_day),
                  price: formatThousands(
                      Math.min(
                          ...Object.values(data.packages)
                              .filter((pkg) => pkg.event_id === mine.event_id && pkg.price > 0)
                              .map((pkg) => pkg.price),
                      ),
                  ),
              })}</div>`
            : '';
    return tileHtml(
        itemDisplayName(data.items, mine.currency_item_id, locale),
        `<div class="pick-total">${iconHtml(mine.currency_item_id)}${tHtml('events.mineTotal', {
            count: `<strong>${formatThousands(total, 0)}</strong>`,
        })}</div>
        ${bar}${markLabel}${legend}${noBonus}
        <div class="plan-tile__total pick-foot">
            <span>${t('events.spentDigging')} <strong>${formatThousands(econ.spent, 0)}</strong></span>
            <span>${t('events.mineStat.left')} <strong>${formatThousands(Math.max(0, total - econ.spent), 0)}</strong></span>
        </div>`,
    );
}

/**
 * The mine table: one row per stretch of floors from the floor reached (mineEconomics), each with a Details
 * block (mineDetailsHtml), then the wish rewards with the plan's pick.
 */
function renderMine({ mineId, mine }) {
    const dug = mine ? minePlan(mineId) : null;
    mineSection.hidden = !dug;
    if (!dug) {
        return;
    }
    const locale = getLocale();
    const pickaxeIcon = iconHtml(mine.currency_item_id);
    mineHeading.textContent = localizedName(mine.name, locale);
    const buyBadge = (text) => `<span class="buy-badge">${text}</span>`;
    const econ = mineEconomics(dug);
    const { rows, wishWorths } = econ;
    const maxRatio = Math.max(1, ...rows.map((row) => row.ratio).filter(Number.isFinite));
    const floorRows = rows.map((row) => {
        const { segment, worth, cost, ratio } = row;
        const label = t('events.mineFloors', {
            from: formatThousands(segment.from),
            to: formatThousands(segment.to),
        });
        let reward = '';
        if (segment.reward) {
            reward = ` <span class="text-dim">+ ${bundleLabel(segment.reward, data.items, locale)}</span>`;
        } else if (segment.aboveTarget) {
            reward = ` <span class="text-dim">${escapeHtml(t('events.mineAboveTarget'))}</span>`;
        }
        const key = `mine:${mineId}:${segment.from}`;
        return (
            gridRow(
                [
                    cell(`${pickaxeIcon}${escapeHtml(label)}${reward}`, 'item-cell'),
                    numCell(`≈${formatThousands(segment.pickaxes, 0)} ${pickaxeIcon}`),
                    numCell(cost > 0 ? gold(formatThousands(cost, 0)) : t('common.dash'), WIDE),
                    numCell(gold(formatThousands(worth, 0))),
                    numCell(ratio === null ? t('common.dash') : ratioBarHtml(ratio, maxRatio, { digits: 3 })),
                    numCell(detailsToggleHtml(key, mineExpanded)),
                ],
                { buy: segment.cleared > 0 },
            ) + mineDetailsHtml(key, dug, row, econ)
        );
    });

    const wishRows = mine.wish_rewards.map((reward, index) => {
        const count = dug.wishes[index]?.count || 0;
        const firstItem = Object.keys(reward)[0];
        return gridRow(
            [
                cell(`${iconHtml(firstItem)}${bundleLabel(reward, data.items, locale)}`, 'item-cell'),
                numCell(t('common.dash')),
                numCell(t('common.dash'), WIDE),
                numCell(gold(formatThousands(wishWorths[index], 0))),
                numCell(''),
                numCell(count > 0 ? buyBadge(`×${formatThousands(count)}`) : ''),
            ],
            { buy: count > 0 },
        );
    });

    const header = gridRow([
        headerCell('floors'),
        headerCell('pickaxes', true),
        headerCell('costBanknotes', true, true),
        headerCell('worth', true),
        headerCell('ratio', true),
        gridHeader(''),
    ]);
    mineTable.innerHTML = gridTable(
        header,
        `${floorRows.join('')}${gridSection(t('events.wishSection'))}${wishRows.join('')}`,
    );
    hydrateItemIcons(mineTable);
    enableInfoTooltips(mineTable);
    wireDetailsToggles(mineTable, mineExpanded);
    renderMineRules(mine);
}

/**
 * The Details block of a stretch of floors: the progress reward for clearing its last floor, the wish rewards
 * (one per floor; the plan's pick marked with the floors it clears) and the other tiles' rewards expected on
 * the way, each item with its icon and worth.
 */
function mineDetailsHtml(key, dug, { segment }, { wishWorths }) {
    const { mine } = dug;
    const buyBadge = (text) => `<span class="buy-badge">${text}</span>`;
    const intro = (text) => `<p class="ranking-grid__details-intro">${escapeHtml(text)}</p>`;
    // One row per item: icon, name × amount and its worth; `extra`: the last cell.
    const itemRow = (part, worth, extra = '') =>
        gridRow([
            cell(part.item, 'item-cell'),
            numCell(''),
            numCell('', WIDE),
            numCell(worth),
            numCell(''),
            numCell(extra),
        ]);
    const partsOf = (bundle) => breakdownParts(valuation.bundle({ contains: bundle }, 0).parts, data, valuation);
    const blocks = [];
    if (segment.reward) {
        blocks.push(
            intro(t('events.mineDetails.reward', { floor: formatThousands(segment.to) })) +
                partsOf(segment.reward)
                    .map((part) => itemRow(part, part.worth))
                    .join(''),
        );
    }
    blocks.push(
        intro(t('events.mineDetails.wishes', { count: formatThousands(segment.floors) })) +
            mine.wish_rewards
                .map((reward, index) => {
                    const [part] = partsOf(reward);
                    const picked = (dug.wishes[index]?.count || 0) > 0 && segment.cleared > 0;
                    return part
                        ? itemRow(
                              part,
                              gold(formatThousands(wishWorths[index], 0)),
                              picked ? buyBadge(`×${formatThousands(segment.cleared)}`) : '',
                          )
                        : '';
                })
                .join(''),
    );
    blocks.push(
        intro(t('events.mineDetails.loot')) +
            partsOf(normalRewardBundle(mine, segment.normalDigs))
                .map((part) => itemRow(part, part.worth))
                .join(''),
    );
    return gridDetails(key, mineExpanded, blocks.join(''));
}

/** A reward bundle as item chips: icon, name (linked) and amount each. */
function bundleIconsHtml(bundle) {
    const locale = getLocale();
    return Object.entries(bundle)
        .map(
            ([id, qty]) =>
                `<span class="item-chip">${iconHtml(id)}${itemLinkName(data.items, id, locale)} ×${formatThousands(qty)}</span>`,
        )
        .join(' ');
}

/**
 * The mine's rules from the data: tiles and weights, the pity by the floor's last digit (with the most and the
 * average digs), the normal tiles' and wish rewards, the free pickaxes, and that pickaxes carry over while the
 * floors don't.
 */
function renderMineRules(mine) {
    const normals = mine.tiles_per_floor - 1;
    const weights = Object.entries(mine.special_weights || {})
        .map(([digs, weight]) => [Number(digs), weight])
        .sort((a, b) => a[0] - b[0])
        .map(([digs, weight]) =>
            digs === 0
                ? formatThousands(weight)
                : t('events.mineRules.weightAfter', { weight: formatThousands(weight), digs: formatThousands(digs) }),
        )
        .join(', ');
    // Last digits with the same pity side by side (…1 / …6: 5 digs).
    const byPity = new Map();
    for (const digit of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
        const pity = mine.pity?.[String(digit)] ?? normals;
        byPity.set(pity, [...(byPity.get(pity) || []), digit]);
    }
    const cellText = (text) => `<td>${escapeHtml(text)}</td>`;
    const pityRows = [...byPity]
        .map(
            ([pity, digits]) =>
                `<tr>${cellText(digits.map((digit) => `…${digit}`).join(' / '))}${cellText(formatThousands(pity))}${cellText(
                    formatThousands(pity + 1),
                )}${cellText(`≈ ${expectedDigs(mine, digits[0] || 10).digs.toFixed(1)}`)}</tr>`,
        )
        .join('');
    const chips = (bundles) =>
        `<div class="mine-rules__chips">${bundles.map((bundle) => bundleIconsHtml(bundle)).join('')}</div>`;
    // The currency as icon and full name ("Dwarven Pickaxe") wherever the rules mention it.
    const pickaxe = `${iconHtml(mine.currency_item_id)}${escapeHtml(itemDisplayName(data.items, mine.currency_item_id, getLocale()))}`;
    const line = (key, vars = {}) => `<li>${tHtml(`events.mineRules.${key}`, { ...vars, pickaxe })}`;
    const header = ['lastDigit', 'pityAfter', 'mostDigs', 'averageDigs']
        .map((key) => `<th>${escapeHtml(t(`events.mineRules.${key}`))}</th>`)
        .join('');
    mineRules.innerHTML = `<summary>${escapeHtml(t('events.mineRules.title'))}</summary>
        <ul class="mine-rules__list">
            ${line('tiles', { tiles: formatThousands(mine.tiles_per_floor), normals: formatThousands(normals) })}</li>
            ${line('weights', { normal: formatThousands(mine.normal_weight), wish: weights })}</li>
            ${line('pity')}
                <table class="mine-rules__pity"><thead><tr>${header}</tr></thead><tbody>${pityRows}</tbody></table>
            </li>
            ${line('normal')}${chips(mine.normal_rewards || [])}</li>
            ${line('wishes')}${chips(mine.wish_rewards || [])}</li>
            ${
                mine.free_currency_per_day > 0
                    ? `${line('free', {
                          perDay: formatThousands(mine.free_currency_per_day),
                          bonus: formatThousands(mine.purchase_bonus_per_day || 0),
                      })}</li>`
                    : ''
            }
            ${line('carry', { floors: formatThousands(mine.floors), target: formatThousands(targetFloor(mine)) })}</li>
        </ul>`;
    hydrateItemIcons(mineRules);
}

/** Saves the "Must buy" locks of the shop table (the whole weekly plan follows them). */
function wireLocks(shopId, shop) {
    // `count` null = unlock; 0 = never buy; otherwise exactly that many per week.
    const save = (offerKey, count) => {
        const lockedOffers = { ...settings.lockedOffers };
        if (count === null) {
            delete lockedOffers[`${shopId}:${offerKey}`];
        } else {
            lockedOffers[`${shopId}:${offerKey}`] = count;
        }
        updateSettings({ lockedOffers });
    };
    shopTable.querySelectorAll('[data-lock]').forEach((button) => {
        button.addEventListener('click', () => {
            const offerKey = button.dataset.lock;
            const locked = `${shopId}:${offerKey}` in (settings.lockedOffers || {});
            // Locking starts at the weekly limit; the count field can lower it, down to 0 (never).
            save(offerKey, locked ? null : offerWeeklyCapacity(shop.offers[offerKey], shop));
        });
    });
    shopTable.querySelectorAll('[data-lock-count]').forEach((input) => {
        input.addEventListener('change', () => {
            const offerKey = input.dataset.lockCount;
            const limit = offerWeeklyCapacity(shop.offers[offerKey], shop);
            save(offerKey, Math.min(limit, Math.max(0, Math.round(Number(input.value) || 0))));
        });
    });
}

/** Whether any pack (nested) or another shop's offer gives the item (no "Only here" badge then). */
function hasOtherSource(shopId, itemId) {
    const cacheKey = `${shopId}:${itemId}`;
    if (!otherSourceCache.has(cacheKey)) {
        const counter = createUnitCounter(data.items, itemId);
        const fromPacks = Object.values(data.packages).some((pkg) => counter.ofBundle(pkg).units > 0);
        const fromShops = Object.entries(data.exchange_shops || {}).some(
            ([otherId, other]) =>
                otherId !== shopId &&
                Object.values(other.offers || {}).some((offer) => counter.ofItem(offer.item_id).units > 0),
        );
        otherSourceCache.set(cacheKey, fromPacks || fromShops);
    }
    return otherSourceCache.get(cacheKey);
}

/**
 * "Your N locked offers cost about X Banknotes of worth": the plan without the locks minus the plan
 * with them (one extra solve, cached per settings); a warning instead if the locks don't fit the spend.
 * Shown on the tab of a shop with locks; other tabs only say which shops' locks share the weekly spend.
 */
function renderLockNote() {
    const shops = data.exchange_shops || {};
    const active = Object.keys(settings.lockedOffers || {}).filter((key) => {
        const shop = shops[key.split(':')[0]];
        return shop && (!shop.event_id || settings.activeEvents.includes(shop.event_id));
    });
    lockNote.hidden = active.length === 0;
    if (active.length === 0) {
        return;
    }
    const lockedShops = [...new Set(active.map((key) => key.split(':')[0]))];
    if (!lockedShops.includes(selection()?.shopId)) {
        lockNote.className = 'text-dim';
        lockNote.textContent = t('events.lockElsewhere', {
            shops: lockedShops.map((shopId) => localizedName(shops[shopId].name)).join(', '),
        });
        return;
    }
    const overrides = pageOverrides();
    const cacheKey = `${JSON.stringify(settings)}|${overridesKey()}`;
    if (lockCostCache.key !== cacheKey) {
        const unlocked = solveWeeklyPlan(
            valuation.highs,
            data,
            planOptions(data, settings, { ...overrides, lockedOffers: {} }),
        );
        lockCostCache = { key: cacheKey, cost: (unlocked.totalPoints - valuation.plan.totalPoints) / valuation.rate };
    }
    const parts = [
        `<span class="text-dim">${t('events.lockCost', {
            count: formatThousands(active.length),
            worth: formatThousands(Math.max(0, lockCostCache.cost), 0),
        })}</span>`,
    ];
    // Fixed amounts the spend can't fully cover: the plan bought as many as possible.
    const shortfalls = valuation.plan.lockShortfalls || [];
    if (shortfalls.length > 0) {
        const items = shortfalls.map(({ key, wanted, got }) => {
            const [shopId, offerKey] = key.split(':');
            const offer = shops[shopId]?.offers?.[offerKey];
            return tHtml('events.lockShortfallItem', {
                item: offer ? itemDisplayName(data.items, offer.item_id, getLocale()) : offerKey,
                got: formatThousands(got),
                wanted: formatThousands(wanted),
            });
        });
        parts.push(`<span class="text-warn">${tHtml('events.lockShortfall', { items: items.join(', ') })}</span>`);
    }
    lockNote.className = '';
    lockNote.innerHTML = parts.join(' ');
}

function renderSteps({ eventId }) {
    // Only events with packages on sale have something to spend Banknotes on.
    stepsCard.hidden = !eventId || !(eventMaxSpend(eventId) > 0);
    if (stepsCard.hidden) {
        return;
    }
    const cacheKey = `${eventId}|${overridesKey()}|${JSON.stringify(settings)}`;
    if (stepCache.key !== cacheKey) {
        stepCache = { key: cacheKey, steps: stepAnalysis(eventId) };
    }
    const steps = stepCache.steps;
    const locale = getLocale();
    const maxRatio = Math.max(1, ...steps.map((step) => step.ratio).filter(Number.isFinite));
    const packsHtml = (packs) =>
        packs.length > 0
            ? `<ul class="cell-list">${packs.map((p) => `<li>${packageDisplayName(p.pkg, locale)} ×${formatThousands(p.count)}</li>`).join('')}</ul>`
            : t('common.dash');
    const rows = steps.map((step) =>
        gridRow(
            [
                numCell(
                    `${step.isPlan ? `<span class="text-dim">${t('events.yourPlan')}</span>&nbsp;` : ''}${gold(formatThousands(step.eventSpend, 0))}`,
                ),
                numCell(step.stepCost === null ? t('common.dash') : gold(formatThousands(step.stepCost, 0))),
                numCell(step.stepWorth === null ? t('common.dash') : gold(formatThousands(step.stepWorth, 0))),
                numCell(step.ratio === null ? t('common.dash') : ratioBarHtml(step.ratio, maxRatio, { digits: 3 })),
                cell(packsHtml(step.packs)),
            ],
            { buy: step.isPlan },
        ),
    );
    const header = gridRow([
        headerCell('eventSpend', true),
        headerCell('stepCost', true),
        headerCell('stepWorth', true),
        headerCell('stepRatio', true),
        headerCell('packs'),
    ]);
    stepsTable.innerHTML = gridTable(header, rows.join(''));
    stepsNote.textContent = t('events.stepsNote');
}

function render() {
    const selected = selection();
    promptCard.hidden = Boolean(selected);
    planCard.hidden = !selected;
    exceedLimits.disabled = !isExceedable(selected?.eventId);
    exceedLimits.checked = exceedTicked(selected?.eventId);
    extraDiamondsField.hidden = !isVipShop(selected);
    extraBanknotesField.hidden = !(selected?.eventId && eventMaxSpend(selected.eventId) > 0);
    exceedField.hidden = extraBanknotesField.hidden;
    extraBanknotesInput.value = String(extraFor(selected?.eventId));
    minePickaxesField.hidden = !selected?.mine;
    mineFloorField.hidden = !selected?.mine;
    if (selected?.mine) {
        const progress = mineProgressFor(selected.mineId, mineRun(selected.eventId));
        minePickaxesInput.value = String(progress.owned);
        mineFloorInput.value = String(progress.floor);
        mineFloorInput.max = String(selected.mine.floors);
    }
    exceedNote.hidden = !exceeding();
    if (!selected) {
        stepsCard.hidden = true;
        return;
    }
    // The event's art and when it runs, as of today: is it on, and how long is left? (The VIP Shop has no event.)
    const event = selected.eventId ? data.events?.[selected.eventId] : null;
    eventBanner.hidden = !event;
    eventBanner.innerHTML = event
        ? eventBannerHtml({
              image: event.image,
              name: localizedName(event.name),
              timing: scheduleTiming(data, selected.eventId),
          })
        : '';
    // The countdown ticks; once it runs out (the event ended or started) the banner shows the new state.
    startCountdowns(eventBanner, render);
    renderLockNote();
    renderSummary(selected);
    renderShop(selected);
    renderMine(selected);
    renderSteps(selected);
}

/**
 * The tabs: the ticked events, then the shops without event (VIP Shop). Keeps the tab shown while it's still
 * listed, else shows the first one.
 */
function populateSelect() {
    const entries = [];
    for (const id of settings.activeEvents.filter((eventId) => data.events?.[eventId])) {
        entries.push([`event:${id}`, data.events[id].name, eventImageUrl(data.events[id].image)]);
    }
    for (const [id, shop] of Object.entries(data.exchange_shops || {})) {
        if (!shop.event_id) {
            entries.push([`shop:${id}`, shop.name, null]);
        }
    }
    if (!entries.some(([key]) => key === selectedKey)) {
        selectedKey = entries[0]?.[0] ?? '';
    }
    eventTabs.innerHTML = entries
        .map(
            ([key, name, image]) =>
                `<button type="button" class="toggle-chip" data-tab="${escapeHtml(key)}" aria-pressed="${key === selectedKey}">${
                    image
                        ? `<img class="toggle-chip__thumb" src="${escapeHtml(image)}" alt="" loading="lazy" decoding="async" />`
                        : ''
                }${escapeHtml(localizedName(name))}</button>`,
        )
        .join('');
}

/** With exceeded limits, locks or extra diamonds / Banknotes the plan depends on the selection. */
function onEventChange() {
    if (
        settings.exceedEventLimits?.length > 0 ||
        Object.keys(settings.lockedOffers || {}).length > 0 ||
        settings.extraDiamonds > 0 ||
        Object.keys(settings.extraEventBanknotes || {}).length > 0 ||
        overridesKey() !== valuationKey
    ) {
        void recompute();
    } else {
        void withLoading(render);
    }
}

function renderExceedInfo() {
    const exceedable = Object.keys(data.events || {})
        .filter(isExceedable)
        .map((id) => localizedName(data.events[id].name));
    exceedLimitsInfo.innerHTML = infoIconHtml(
        t('events.exceedLimitsHint', { events: exceedable.join(', ') || t('common.dash') }),
    );
    enableInfoTooltips(exceedLimitsInfo);
}

async function recompute() {
    await withLoading(async () => {
        populateSelect();
        valuationKey = overridesKey();
        valuation = await buildValuation(data, settings, pageOverrides());
        panel.showRate(valuation);
        render();
    });
}

startPage('events', {
    async init(loaded) {
        data = loaded;
        settings = getSettings();
        panel = mountValuationPanel(document.getElementById('valuation-panel'), data, {
            fields: ['budget', 'events', 'passes'],
        });
        eventTabs.addEventListener('click', (event) => {
            const tab = event.target.closest('[data-tab]');
            if (!tab || tab.dataset.tab === selectedKey) {
                return;
            }
            selectedKey = tab.dataset.tab;
            for (const button of eventTabs.querySelectorAll('[data-tab]')) {
                button.setAttribute('aria-pressed', String(button.dataset.tab === selectedKey));
            }
            setUrlParams({ event: selectedKey });
            onEventChange();
        });
        chooseEvents.addEventListener('click', () => panel.open());
        onSettingsChange((next) => {
            settings = next;
            recompute();
        });
        renderExceedInfo();
        extraDiamondsInput.value = String(settings.extraDiamonds || 0);
        extraDiamondsInput.addEventListener('change', () =>
            updateSettings({ extraDiamonds: Math.max(0, Number(extraDiamondsInput.value) || 0) }),
        );
        extraBanknotesInput.addEventListener('change', () => {
            const eventId = selection()?.eventId;
            if (!eventId) {
                return;
            }
            const amount = Math.max(0, Number(extraBanknotesInput.value) || 0);
            const extraEventBanknotes = { ...settings.extraEventBanknotes, [eventId]: amount };
            if (amount === 0) {
                delete extraEventBanknotes[eventId];
            }
            updateSettings({ extraEventBanknotes });
        });
        // The mine's pickaxes owned and floor reached (the floor for the run it was entered in).
        const saveMineProgress = () => {
            const selected = selection();
            if (!selected?.mine) {
                return;
            }
            const whole = (input, max = Infinity) => Math.min(max, Math.max(0, Math.round(Number(input.value) || 0)));
            const mineProgress = {
                ...settings.mineProgress,
                [selected.mineId]: {
                    pickaxes: whole(minePickaxesInput),
                    floor: whole(mineFloorInput, selected.mine.floors),
                    run: mineRun(selected.eventId)?.start ?? null,
                },
            };
            updateSettings({ mineProgress });
        };
        minePickaxesInput.addEventListener('change', saveMineProgress);
        // The verdict card is re-rendered with the plan: its safety radios are wired here, once.
        eventSummary.addEventListener('change', (event) => {
            if (event.target.name === 'mine-safety') {
                updateSettings({ minePlanSafety: Number(event.target.value) });
            }
        });
        mineFloorInput.addEventListener('change', saveMineProgress);
        exceedLimits.addEventListener('change', () => {
            const eventId = selection()?.eventId;
            if (!eventId) {
                return;
            }
            const others = (settings.exceedEventLimits || []).filter((id) => id !== eventId);
            updateSettings({ exceedEventLimits: exceedLimits.checked ? [...others, eventId] : others });
        });
        await recompute();
    },
    onLocaleChange() {
        renderExceedInfo();
        populateSelect();
        render();
    },
});
