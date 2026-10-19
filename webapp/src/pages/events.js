import { startPage } from '../ui/page.js';
import { buildValuation, planOptions } from '../ui/valuation.js';
import { solveWeeklyPlan } from '../core/planner.js';
import { mountValuationPanel } from '../ui/valuation-panel.js';
import { getSettings, updateSettings, onSettingsChange } from '../ui/settings.js';
import { withLoading } from '../ui/loading.js';
import { packageWeeklyCapacity, offerWeeklyCapacity, isOnSale } from '../core/catalog.js';
import { createUnitCounter } from '../core/item-sources.js';
import { urlParam, setUrlParams } from '../ui/url.js';
import { packageDisplayName, itemDisplayName, itemLinkName, bundleLabel } from '../ui/labels.js';
import { banknotesHtml, escapeAttr, escapeHtml, itemIconSlot, hydrateItemIcons } from '../ui/html.js';
import { gridCell, gridNum, gridHeader, gridRow, gridTable, gridSection } from '../ui/grid.js';
import { enableInfoTooltips } from '../ui/tooltip.js';
import { infoIconHtml } from '../ui/info-icon.js';
import { t, tHtml, getLocale, localizedName } from '../ui/i18n.js';
import { formatThousands, formatSignificant } from '../ui/format.js';
import { ratioBarHtml } from '../ui/ratio-bar.js';
import { eventBannerHtml, eventImageUrl, scheduleTiming } from '../ui/event-banner.js';

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
// itemId -> whether any pack or another shop gives it (for the "Only here" badge), per shop.
const otherSourceCache = new Map();

const gold = banknotesHtml;
const iconHtml = itemIconSlot;
const cell = (html, className = '') => gridCell(html, { className });
const numCell = gridNum;
// `wide`: column hidden on phones (Limit, Cost in Banknotes of the shop table).
const WIDE = { wide: true };
const headerCell = (key, num = false, wide = false) => gridHeader(t(`events.table.${key}`), { num, wide });

/** The selection: an event (`event:<id>`, with its shop if any) or a shop without event (`shop:<id>`). */
function selection() {
    const [kind, id] = selectedKey.split(':');
    if (kind === 'event' && data.events?.[id]) {
        const shopEntry = Object.entries(data.exchange_shops || {}).find(([, shop]) => shop.event_id === id);
        return { eventId: id, shopId: shopEntry?.[0] ?? null, shop: shopEntry?.[1] ?? null };
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
 * Planner options of this page: the selected event's pack limits lifted when exceeding, its extra
 * Banknotes on top of the weekly spend; for the VIP Shop, the extra diamonds per week on top of what
 * the packs give.
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
    return overrides;
}

const eventPurchases = (plan, eventId) => plan.purchases.filter((p) => p.pkg.event_id === eventId);
const eventPackSpend = (plan, eventId) => eventPurchases(plan, eventId).reduce((sum, p) => sum + p.spend, 0);

/** Most Banknotes the event's packages can take per week (unlimited with exceeded limits). */
function eventMaxSpend(eventId) {
    const rules = { activeEventIds: new Set([eventId]) };
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

/** "Your plan": one tile per step — packs to buy, coins, Encounters, bonus tiers. */
function renderSummary({ eventId, shopId, shop }) {
    const locale = getLocale();
    const plan = valuation.plan;
    const tiles = [];
    if (eventId) {
        const purchases = eventPurchases(plan, eventId);
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
                  }${
                      extraFor(eventId) > 0
                          ? `<div class="plan-tile__note text-dim">${t('events.extraBanknotesNote', {
                                amount: formatThousands(extraFor(eventId), 0),
                            })}</div>`
                          : ''
                  }`
                : `<span class="text-dim">${t('events.summaryNoPacks')}</span>`;
        tiles.push(tileHtml(t('events.tiles.packs'), body));
    }
    if (shop) {
        const coin = plan.currencies.get(shop.currency_item_id);
        const coinName = itemDisplayName(data.items, shop.currency_item_id, locale);
        tiles.push(
            tileHtml(
                coinName,
                `<div class="plan-stat">${iconHtml(shop.currency_item_id)}<strong>${formatThousands(coin?.received ?? 0, 0)}</strong> ${t('events.received')}</div>
                ${coin?.extra ? `<div class="plan-stat">+ <strong>${formatThousands(coin.extra, 0)}</strong> ${t('events.extra')}</div>` : ''}
                <div class="plan-stat text-dim">${formatThousands(coin?.spent ?? 0, 0)} ${t('events.spentInShop')}</div>`,
            ),
        );
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
    const totals = itemTotals({ eventId, shopId, shop });
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
 * options), the shop offers bought and the bonus tiers reached, minus what Encounters cost (diamonds).
 * The shop's own coins are left out (they're spent in the shop). Sorted by worth.
 */
function itemTotals({ eventId, shopId, shop }) {
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
    const overrides = pageOverrides();
    const cacheKey = `${JSON.stringify(settings)}|${JSON.stringify(overrides, (k, v) => (v instanceof Set ? [...v] : v))}`;
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
    const cacheKey = `${eventId}|${exceeding()}|${JSON.stringify(settings)}`;
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
    renderLockNote();
    renderSummary(selected);
    renderShop(selected);
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
        Object.keys(settings.extraEventBanknotes || {}).length > 0
    ) {
        recompute();
    } else {
        withLoading(render);
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
