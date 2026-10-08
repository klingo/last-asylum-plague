import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { buildValuation, modelSummaryText, planOptions } from './lib/valuation';
import { solveWeeklyPlan } from './lib/planner.js';
import { mountValuationPanel } from './lib/valuation-panel';
import { withLoading } from './lib/loading';
import { expandPackageFamilies, packageWeeklyCapacity } from './lib/catalog.js';
import { packageDisplayName, itemDisplayName, bundleLabel } from './lib/labels';
import { createItemImage, banknoteIconHtml } from './lib/images';
import { enableInfoTooltips } from './lib/tooltip';
import { infoIconHtml } from './lib/requires-tooltip';
import { t, getLocale, localizedName, applyStaticTranslations } from './lib/i18n';
import { formatThousands, formatSignificant } from './lib/format';
import { ratioBarHtml } from './lib/ratio-bar';

renderNav('events');
applyStaticTranslations();

const eventSelect = document.getElementById('event-select');
const exceedLimits = document.getElementById('exceed-limits');
const exceedLimitsInfo = document.getElementById('exceed-limits-info');
const promptCard = document.getElementById('event-prompt-card');
const planCard = document.getElementById('plan-card');
const exceedNote = document.getElementById('exceed-note');
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
let stepCache = { key: null, steps: null };

const gold = (text) => `<span class="text-gold">${text}</span> ${banknoteIconHtml()}`;
// Item image placeholder, swapped for the real <img> by hydrateIcons() after rendering.
const iconHtml = (itemId) => `<span class="breakdown-icon" data-item-id="${itemId}"></span>`;
const cell = (html, extraClass = '') => `<div class="ranking-grid__cell ${extraClass}" role="cell">${html}</div>`;
const numCell = (html) => cell(html, 'ranking-grid__cell--num');
const headerCell = (key, num = false) =>
    `<div class="ranking-grid__cell ranking-grid__cell--header${num ? ' ranking-grid__cell--num' : ''}" role="columnheader">${t(`events.table.${key}`)}</div>`;

function hydrateIcons(root) {
    root.querySelectorAll('[data-item-id]').forEach((placeholder) => {
        const itemId = placeholder.getAttribute('data-item-id');
        placeholder.replaceWith(createItemImage(itemId, itemId, 'item-icon item-icon--sm'));
    });
}

/** The selection: an event (`event:<id>`, with its shop if any) or a shop without event (`shop:<id>`). */
function selection() {
    const [kind, id] = eventSelect.value.split(':');
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

/** Whether this page lifts the selected event's pack limits: box ticked and the event allows it. */
function exceeding() {
    return exceedLimits.checked && isExceedable(selection()?.eventId);
}

/** Planner options of this page: the selected event's pack limits lifted when exceeding. */
function pageOverrides() {
    return exceeding() ? { exceedEventPackLimits: new Set([selection().eventId]) } : {};
}

const eventPurchases = (plan, eventId) => plan.purchases.filter((p) => p.pkg.event_id === eventId);
const eventPackSpend = (plan, eventId) => eventPurchases(plan, eventId).reduce((sum, p) => sum + p.spend, 0);

/** Most Banknotes the event's packages can take per week (unlimited with exceeded limits). */
function eventMaxSpend(eventId) {
    const rules = { activeEventIds: new Set([eventId]) };
    const packages = Object.values(expandPackageFamilies(data.packages)).filter(
        (pkg) => pkg.event_id === eventId && pkg.price > 0 && packageWeeklyCapacity(pkg, rules) > 0,
    );
    if (exceeding() && packages.length > 0) {
        return Infinity;
    }
    return packages.reduce((sum, pkg) => sum + packageWeeklyCapacity(pkg, rules) * pkg.price, 0);
}

/** Price of the event's cheapest pack (whole packs rarely hit a spend level exactly). */
function cheapestEventPack(eventId) {
    const prices = Object.values(expandPackageFamilies(data.packages))
        .filter((pkg) => pkg.event_id === eventId && pkg.price > 0)
        .map((pkg) => pkg.price);
    return prices.length > 0 ? Math.min(...prices) : 0;
}

/**
 * How much spending on the event is worth it: the weekly plan re-solved with the event's pack spend
 * at 0, at your plan's own spend E₀ and at round levels above it, the rest of your weekly spend
 * unchanged (budget = weekly spend − E₀ + level). Step ratio = the step's extra points (in Banknotes
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
                    budget: settings.budget - e0 + level,
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
                            const tip = bundleLabel(shop.bonus_tiers[String(x)], data.items, locale).replace(
                                /"/g,
                                '&quot;',
                            );
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
                            `<li><span class="item-chip">${iconHtml(id)}${itemDisplayName(data.items, id, locale)}</span><strong class="${qty < 0 ? 'text-bad' : ''}">${qty < 0 ? '−' : '×'}${Number.isInteger(qty) ? formatThousands(Math.abs(qty)) : formatSignificant(Math.abs(qty))}</strong><span>${gold(formatThousands(worth, 0))}</span></li>`,
                    )
                    .join('')}</ul>
                <div class="plan-tile__total">${t('events.totalWorth')} ${gold(formatThousands(totalWorth, 0))}</div>`,
                true,
            ),
        );
    }
    eventSummary.innerHTML = tiles.join('');
    hydrateIcons(eventSummary);
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
            offer,
            count: bought.get(offerKey) || 0,
            worth: b.worth,
            ratio: coinWorth > 0 && !b.incomplete ? b.worth / (offer.currency_cost * coinWorth) : null,
        };
    });
    const maxRatio = Math.max(1, ...offers.map((o) => o.ratio).filter(Number.isFinite));
    const stages = [...new Set(offers.map((o) => o.offer.unlock_points || 0))].sort((a, b) => a - b);
    const coinIcon = iconHtml(shop.currency_item_id);
    const buyBadge = (text) => `<span class="buy-badge">${text}</span>`;
    const rowClass = (buy) => `ranking-grid__row${buy ? ' ranking-grid__row--buy' : ''}`;
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

    const groups = stages.map((stage) => {
        const heading =
            stages.length > 1
                ? `<div class="ranking-grid__section">${stage > 0 ? t('events.unlockAt', { points: formatThousands(stage) }) : t('events.unlockStart')}</div>`
                : '';
        const rows = offers
            .filter((o) => (o.offer.unlock_points || 0) === stage)
            .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
            .map(
                ({ offer, count, worth, ratio }) => `<div class="${rowClass(worthBuying({ count, ratio }))}" role="row">
                    ${cell(`${iconHtml(offer.item_id)}${itemDisplayName(data.items, offer.item_id, locale)} ×${formatThousands(offer.quantity)}`, 'item-cell')}
                    ${numCell(`${formatThousands(offer.currency_cost)} ${coinIcon}`)}
                    ${numCell(coinWorth > 0 ? gold(formatThousands(offer.currency_cost * coinWorth, 0)) : t('common.dash'))}
                    ${numCell(gold(formatThousands(worth, 0)))}
                    ${numCell(ratio === null ? t('common.dash') : ratioBarHtml(ratio, maxRatio, { digits: 3 }))}
                    ${numCell(buyCell({ count, ratio }))}
                </div>`,
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
            return `<div class="${rowClass(reached.has(threshold))}" role="row">
                ${cell(`${iconHtml(firstItem)}${t('events.bonusTier', { threshold: formatThousands(threshold) })}: ${bundleLabel(reward, data.items, locale)}`, 'item-cell')}
                ${numCell(t('common.dash'))}
                ${numCell(t('common.dash'))}
                ${numCell(gold(formatThousands(b.worth, 0)))}
                ${numCell('')}
                ${numCell(reached.has(threshold) ? buyBadge(`✓ ${t('events.reached')}`) : '')}
            </div>`;
        });

    shopTable.innerHTML = `
        <div class="ranking-grid__row" role="row">
            ${headerCell('offer')}${headerCell('cost', true)}${headerCell('costBanknotes', true)}${headerCell('worth', true)}${headerCell('ratio', true)}${headerCell(shop.random_offers ? 'buyIfOffered' : 'buy', true)}
        </div>
        ${groups.join('')}
        ${tierRows.length > 0 ? `<div class="ranking-grid__section">${t('events.bonusSection')}</div>${tierRows.join('')}` : ''}`;
    hydrateIcons(shopTable);
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
    const rows = steps.map(
        (step) => `<div class="ranking-grid__row${step.isPlan ? ' ranking-grid__row--buy' : ''}" role="row">
            ${numCell(`${step.isPlan ? `<span class="text-dim">${t('events.yourPlan')}</span>&nbsp;` : ''}${gold(formatThousands(step.eventSpend, 0))}`)}
            ${numCell(step.stepCost === null ? t('common.dash') : gold(formatThousands(step.stepCost, 0)))}
            ${numCell(step.stepWorth === null ? t('common.dash') : gold(formatThousands(step.stepWorth, 0)))}
            ${numCell(step.ratio === null ? t('common.dash') : ratioBarHtml(step.ratio, maxRatio, { digits: 3 }))}
            ${cell(packsHtml(step.packs))}
        </div>`,
    );
    stepsTable.innerHTML = `
        <div class="ranking-grid__row" role="row">
            ${headerCell('eventSpend', true)}${headerCell('stepCost', true)}${headerCell('stepWorth', true)}${headerCell('stepRatio', true)}${headerCell('packs')}
        </div>
        ${rows.join('')}`;
    stepsNote.textContent = `${t('events.stepsNote')} ${modelSummaryText(valuation)}`;
}

function render() {
    const selected = selection();
    promptCard.hidden = Boolean(selected);
    planCard.hidden = !selected;
    exceedLimits.disabled = !isExceedable(selected?.eventId);
    exceedNote.hidden = !exceeding();
    if (!selected) {
        stepsCard.hidden = true;
        return;
    }
    renderSummary(selected);
    renderShop(selected);
    renderSteps(selected);
}

function populateSelect() {
    const previous = eventSelect.value;
    const options = [
        ...settings.activeEvents
            .filter((id) => data.events?.[id])
            .map((id) => [`event:${id}`, localizedName(data.events[id].name)]),
        ...Object.entries(data.exchange_shops || {})
            .filter(([, shop]) => !shop.event_id)
            .map(([id, shop]) => [`shop:${id}`, localizedName(shop.name)]),
    ];
    eventSelect.innerHTML = `<option value="" disabled>${t('events.eventPlaceholder')}</option>${options
        .map(([value, name]) => `<option value="${value}">${name}</option>`)
        .join('')}`;
    eventSelect.value = options.some(([value]) => value === previous) ? previous : '';
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
        render();
    });
}

async function init() {
    data = await loadPackData();
    const panel = mountValuationPanel(document.getElementById('valuation-panel'), data, {
        fields: ['budget', 'events', 'passes'],
        onChange: (next) => {
            settings = next;
            recompute();
        },
    });
    settings = panel.getSettings();
    renderExceedInfo();
    // With exceeded limits the plan depends on the selected event; otherwise it's the Ranking's plan.
    eventSelect.addEventListener('change', () => (exceedLimits.checked ? recompute() : withLoading(render)));
    exceedLimits.addEventListener('change', recompute);
    window.addEventListener('localechange', () => {
        applyStaticTranslations();
        renderExceedInfo();
        populateSelect();
        render();
    });
    await recompute();
}

init().catch((error) => {
    console.error(error);
    document
        .querySelector('main')
        .insertAdjacentHTML(
            'afterbegin',
            `<div class="card"><p class="text-bad">${t('common.loadError', { message: error.message })}</p></div>`,
        );
});
