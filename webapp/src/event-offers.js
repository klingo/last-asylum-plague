import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { buildEventOffers } from './lib/ranking-core';
import { createMarket, packageYield, effectiveCapacity } from './lib/pricing-core';
import { buildPurchasePlan } from './lib/purchase-plan';
import { createItemImage, banknoteIconHtml } from './lib/images';
import { enableInfoTooltips } from './lib/tooltip';
import { t, getLocale, localizedName, categoryLabel, applyStaticTranslations } from './lib/i18n';
import { formatUnitPrice, formatThousands } from './lib/format';

renderNav('event-offers');
applyStaticTranslations();

const eventSelect = document.getElementById('event-select');
const daysInput = document.getElementById('days-input');
const exceedPackLimitsCheckbox = document.getElementById('exceed-pack-limits-checkbox');
const fallbackCheckbox = document.getElementById('fallback-checkbox');
const offersPrompt = document.getElementById('offers-prompt');
const offersEmpty = document.getElementById('offers-empty');
const offersWrap = document.getElementById('offers-wrap');
const offersTable = document.getElementById('offers-table');
const bonusTiersSection = document.getElementById('bonus-tiers-section');
const bonusTiersTable = document.getElementById('bonus-tiers-table');
const loadingOverlay = document.getElementById('loading-overlay');

let rawData = null;
let itemsById = {};
// Events with a shop that has at least one directly purchasable offer AND a package that sells
// its currency (see plan: `full_moon_night`'s currency has no selling package, and
// `surprise_encounter`'s shop has no direct offers — both excluded here).
let eligibleEvents = [];
// Row keys (see `rowKey`) whose "Details" section is currently expanded, restored across a
// re-render triggered by something that doesn't change which rows exist (a locale switch).
const expandedRowKeys = new Set();

function rowKey(prefix, id) {
    return `${prefix}:${id}`;
}

// --bad -> --good (see style.css) in RGB, interpolated per row's ratio-bar fill below.
const RATIO_BAD_RGB = [242, 104, 92];
const RATIO_GOOD_RGB = [99, 214, 138];

function ratioBarColor(fraction) {
    const channel = (from, to) => Math.round(from + (to - from) * fraction);
    return `rgb(${channel(RATIO_BAD_RGB[0], RATIO_GOOD_RGB[0])}, ${channel(RATIO_BAD_RGB[1], RATIO_GOOD_RGB[1])}, ${channel(RATIO_BAD_RGB[2], RATIO_GOOD_RGB[2])})`;
}

// Scales a row's ratio-bar fill from 0 (ratio 1.000, the "break-even" floor) to 1 (the best
// ratio among the CURRENTLY displayed rows in the same table) — a fixed floor but a relative
// ceiling, same convention as spend-rewards.js.
function ratioBarFraction(ratio, maxRatio) {
    if (!Number.isFinite(ratio) || maxRatio <= 1) {
        return 0;
    }
    return Math.min(1, Math.max(0, (ratio - 1) / (maxRatio - 1)));
}

function statusCellHtml(row) {
    if (!row.cost_reachable) {
        return `<span class="text-bad">${t('eventOffers.table.unreachable')}</span>`;
    }
    if (!row.value_complete) {
        return `<span class="text-bad">${t('common.no')}</span>`;
    }
    if (row.value_estimated) {
        return `<span class="text-warn">${t('eventOffers.table.estimatedShort')}</span>`;
    }
    return `<span class="text-good">${t('common.yes')}</span>`;
}

// `midBlanks` pads out the row to match whichever grid it's rendered into: the Offers grid has
// one extra numeric column (Max Ratio) that Bonus Tiers doesn't, so its breakdown rows need one
// more blank cell to keep the subgrid's columns aligned with the outer row above them — unless
// `maxCostValue` (`{cost, value}`) is given, in which case those two slots (aligned under the
// outer row's Value Ratio / Max Ratio columns) show the offer's Max Cost/Max Value instead of
// staying blank, so the raw totals behind the Max Ratio column are visible on expand. An offer
// only ever declares one reward item (see module header elsewhere), so this never needs to
// worry about repeating those totals across multiple breakdown rows.
function breakdownRowsHtml(row, { midBlanks = 1, maxCostValue = null } = {}) {
    const blankCell = '<div class="ranking-grid__cell"></div>';
    const bankCell = (value) =>
        `<div class="ranking-grid__cell ranking-grid__cell--num">${
            Number.isFinite(value)
                ? `<span class="text-gold">${formatThousands(value, 2)}</span> ${banknoteIconHtml()}`
                : t('common.notAvailable')
        }</div>`;
    const midCellsHtml = maxCostValue
        ? `${bankCell(maxCostValue.cost)}${bankCell(maxCostValue.value)}`
        : blankCell.repeat(midBlanks);
    return [...row.contains_breakdown]
        .sort((a, b) => b.value - a.value)
        .map(
            (item) => `
                <div class="ranking-grid__row">
                    <div class="ranking-grid__cell item-cell"><span class="breakdown-icon" data-item-id="${item.item_id}"></span>${item.name} &times;${item.quantity}</div>
                    <div class="ranking-grid__cell">${categoryLabel(itemsById[item.item_id]?.category)}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num">${item.unit_cost !== null ? `<span class="text-gold">${formatUnitPrice(item.unit_cost, { minDecimals: 4 })}</span> ${banknoteIconHtml()}` : t('common.unknown')}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num"><span class="text-gold">${formatThousands(item.value, 2)}</span> ${banknoteIconHtml()}</div>
                    ${midCellsHtml}
                    <div class="ranking-grid__cell">${
                        item.known === false
                            ? `<span class="text-bad">${t('rankings.table.incomplete')}</span>`
                            : item.estimated
                              ? `<span class="text-warn">${t('eventOffers.table.estimated')}</span>`
                              : ''
                    }</div>
                    <div class="ranking-grid__cell"></div>
                </div>
            `,
        )
        .join('');
}

function wireExpandToggles(container) {
    container.querySelectorAll('[data-item-id]').forEach((placeholder) => {
        const itemId = placeholder.getAttribute('data-item-id');
        const img = createItemImage(itemId, itemId, 'item-icon item-icon--sm');
        placeholder.replaceWith(img);
    });
    enableInfoTooltips(container);

    container.querySelectorAll('.expand-toggle').forEach((button) => {
        button.addEventListener('click', () => {
            const key = button.getAttribute('data-row-key');
            const detailsSection = container.querySelector(`[data-row-key-details="${key}"]`);
            const isHidden = detailsSection.hidden;
            detailsSection.hidden = !isHidden;
            button.textContent = isHidden ? t('common.hide') : t('common.details');
            if (isHidden) {
                expandedRowKeys.add(key);
            } else {
                expandedRowKeys.delete(key);
            }
        });
    });

    expandedRowKeys.forEach((key) => {
        const detailsSection = container.querySelector(`[data-row-key-details="${key}"]`);
        const button = container.querySelector(`.expand-toggle[data-row-key="${key}"]`);
        if (!detailsSection || !button) {
            return;
        }
        detailsSection.hidden = false;
        button.textContent = t('common.hide');
    });
}

function renderOffers(offers, currencyName) {
    const maxRatio = offers.reduce(
        (max, row) => (Number.isFinite(row.value_ratio) ? Math.max(max, row.value_ratio) : max),
        1,
    );
    // Independent ceiling from the regular Value Ratio bar above: "buy just one" and "buy to the
    // purchase limit" are different metrics with their own scales, so one column's ratio bar
    // shouldn't be stretched or squashed by the other's range.
    const maxOfMaxRatio = offers.reduce(
        (max, row) => (Number.isFinite(row.max_ratio) ? Math.max(max, row.max_ratio) : max),
        1,
    );

    const rows = offers
        .map((row) => {
            const key = rowKey('offer', row.id);
            const ratioFraction = ratioBarFraction(row.value_ratio, maxRatio);
            const ratioColor = ratioBarColor(ratioFraction);
            const maxRatioFraction = ratioBarFraction(row.max_ratio, maxOfMaxRatio);
            const maxRatioColor = ratioBarColor(maxRatioFraction);
            const maxRatioCell = Number.isFinite(row.max_ratio)
                ? `
                    <div class="ratio-display">
                        <span>${formatThousands(row.max_ratio, 4)}</span>
                        <span class="ratio-bar"><span class="ratio-bar__fill" style="width: ${(maxRatioFraction * 100).toFixed(1)}%; background: ${maxRatioColor}"></span></span>
                        <span class="text-dim ratio-display__note">${t('eventOffers.table.maxQuantity', { quantity: formatThousands(row.max_quantity) })}</span>
                    </div>
                `
                : t('common.notAvailable');
            return `
                <div class="ranking-grid__row" role="row" data-row-key="${key}">
                    <div class="ranking-grid__cell item-cell" role="cell"><span class="breakdown-icon" data-item-id="${row.item_id}"></span>${row.name} &times;${row.quantity}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${formatThousands(row.currency_cost)} ${currencyName}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${row.cost_reachable ? `<span class="text-gold">${formatThousands(row.cost, 2)}</span> ${banknoteIconHtml()}` : t('common.notAvailable')}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell"><span class="text-gold">${formatThousands(row.total_value, 2)}</span> ${banknoteIconHtml()}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">
                        <div class="ratio-display">
                            <span>${Number.isFinite(row.value_ratio) ? formatThousands(row.value_ratio, 4) : t('common.notAvailable')}</span>
                            <span class="ratio-bar"><span class="ratio-bar__fill" style="width: ${(ratioFraction * 100).toFixed(1)}%; background: ${ratioColor}"></span></span>
                        </div>
                    </div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${maxRatioCell}</div>
                    <div class="ranking-grid__cell" role="cell">${statusCellHtml(row)}</div>
                    <div class="ranking-grid__cell" role="cell"><button type="button" class="expand-toggle" data-row-key="${key}">${t('common.details')}</button></div>
                </div>
                <div class="ranking-grid__details" data-row-key-details="${key}" hidden>
                    <div class="ranking-grid__row">
                        <div class="ranking-grid__cell ranking-grid__cell--header">${t('eventOffers.table.item')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header">${t('rankings.table.category')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num">${t('eventOffers.table.unitCost')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num">${t('eventOffers.table.value', { icon: banknoteIconHtml() })}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num">${t('eventOffers.table.maxCost', { icon: banknoteIconHtml() })}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num">${t('eventOffers.table.maxValue', { icon: banknoteIconHtml() })}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                    </div>
                    ${breakdownRowsHtml(row, { maxCostValue: { cost: row.max_cost, value: row.max_value } })}
                </div>
            `;
        })
        .join('');

    offersTable.innerHTML = `
        <div class="ranking-grid__row" role="row">
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">${t('eventOffers.table.item')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('eventOffers.table.currencyCost')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('eventOffers.table.cost', { icon: banknoteIconHtml() })}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('eventOffers.table.value', { icon: banknoteIconHtml() })}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('eventOffers.table.valueRatio')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('eventOffers.table.maxRatio')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">${t('eventOffers.table.status')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader"></div>
        </div>
        ${rows}
    `;
    wireExpandToggles(offersTable);
}

function renderBonusTiers(bonusTiers) {
    if (bonusTiers.length === 0) {
        bonusTiersSection.hidden = true;
        return;
    }
    bonusTiersSection.hidden = false;

    const maxRatio = bonusTiers.reduce(
        (max, tier) => (Number.isFinite(tier.value_ratio) ? Math.max(max, tier.value_ratio) : max),
        1,
    );

    const rows = bonusTiers
        .map((tier, index) => {
            const key = rowKey('bonus', tier.threshold);
            const ratioFraction = ratioBarFraction(tier.value_ratio, maxRatio);
            const ratioColor = ratioBarColor(ratioFraction);
            const tierLabel = t('eventOffers.tierLabel', { tier: index + 1 });
            return `
                <div class="ranking-grid__row" role="row" data-row-key="${key}">
                    <div class="ranking-grid__cell" role="cell">${tierLabel} (<span class="text-gold">${formatThousands(tier.threshold)}</span>)</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${tier.cost_reachable ? `<span class="text-gold">${formatThousands(tier.cumulative_cost, 2)}</span> ${banknoteIconHtml()}` : t('common.notAvailable')}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${tier.cost_reachable ? `<span class="text-gold">${formatThousands(tier.step_cost, 2)}</span> ${banknoteIconHtml()}` : t('common.notAvailable')}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell"><span class="text-gold">${formatThousands(tier.total_value, 2)}</span> ${banknoteIconHtml()}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">
                        <div class="ratio-display">
                            <span>${Number.isFinite(tier.value_ratio) ? formatThousands(tier.value_ratio, 4) : t('common.notAvailable')}</span>
                            <span class="ratio-bar"><span class="ratio-bar__fill" style="width: ${(ratioFraction * 100).toFixed(1)}%; background: ${ratioColor}"></span></span>
                        </div>
                    </div>
                    <div class="ranking-grid__cell" role="cell">${statusCellHtml(tier)}</div>
                    <div class="ranking-grid__cell" role="cell"><button type="button" class="expand-toggle" data-row-key="${key}">${t('common.details')}</button></div>
                </div>
                <div class="ranking-grid__details" data-row-key-details="${key}" hidden>
                    <div class="ranking-grid__row">
                        <div class="ranking-grid__cell ranking-grid__cell--header">${t('eventOffers.table.item')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header">${t('rankings.table.category')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num">${t('eventOffers.table.unitCost')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num">${t('eventOffers.table.value', { icon: banknoteIconHtml() })}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                    </div>
                    ${breakdownRowsHtml(tier)}
                </div>
            `;
        })
        .join('');

    bonusTiersTable.innerHTML = `
        <div class="ranking-grid__row" role="row">
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">${t('eventOffers.table.tier')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('eventOffers.table.cumulativeCost')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('eventOffers.table.stepCost')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('eventOffers.table.value', { icon: banknoteIconHtml() })}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('eventOffers.table.valueRatio')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">${t('eventOffers.table.status')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader"></div>
        </div>
        ${rows}
    `;
    wireExpandToggles(bonusTiersTable);
}

// The event dropdown only lists events whose shop has at least one directly purchasable offer
// AND whose currency is actually sold by some package — see the plan's "Edge-case events"
// decision (`surprise_encounter` has 0 offers; `full_moon_night`'s currency has no selling
// package, a data gap).
function computeEligibleEvents(data) {
    const { items = {}, packages = {}, exchange_shops: exchangeShops = {}, events = {} } = data;
    const eligible = [];
    for (const [eventId, event] of Object.entries(events)) {
        const shopEntry = Object.entries(exchangeShops).find(([, shop]) => shop.event_id === eventId);
        if (!shopEntry) {
            continue;
        }
        const [, shop] = shopEntry;
        if (Object.keys(shop.offers || {}).length === 0) {
            continue;
        }
        const currencyIsSold = Object.values(packages).some(
            (pkg) => packageYield(pkg, shop.currency_item_id, items) > 0,
        );
        if (!currencyIsSold) {
            continue;
        }
        eligible.push({ id: eventId, name: localizedName(event.name) });
    }
    return eligible.sort((a, b) => a.name.localeCompare(b.name));
}

function populateEventSelect() {
    const previousValue = eventSelect.value;
    const optionsHtml = eligibleEvents.map((event) => `<option value="${event.id}">${event.name}</option>`).join('');
    eventSelect.innerHTML = `<option value="" disabled ${previousValue ? '' : 'selected'}>${t('eventOffers.eventPlaceholder')}</option>${optionsHtml}`;
    if (eligibleEvents.some((event) => event.id === previousValue)) {
        eventSelect.value = previousValue;
    }
}

// Bundle-aware pricing (see lib/ranking-core.js) plus the capacity-aware purchase simulation
// below can take a noticeable moment, so any change that triggers them shows a blocking overlay
// first (see rankings.js for why the setTimeout is needed for the overlay to actually paint
// before the heavy synchronous work runs).
function withLoadingOverlay(fn) {
    loadingOverlay.hidden = false;
    setTimeout(() => {
        try {
            fn();
        } finally {
            loadingOverlay.hidden = true;
        }
    }, 0);
}

// Banknote cost to buy a SINGLE purchase of one offer (`currencyCost` units of the shop's
// currency), evaluated completely independently of every other offer: a fresh, entirely
// unconsumed market every time, as if this were the only thing being bought today. The cheapest
// available currency package covers it; if that one package's own purchase limit isn't enough to
// supply `currencyCost` units by itself, `market.purchase()` naturally reaches for additional
// (pricier) packages within this same fresh market — "using up the purchase limit to the max"
// before needing something else, never anything left over from (or shared with) another offer.
function independentPurchaseCost(currencyItemId, currencyCost, limitOptions, marketOptions, locale) {
    const { items, packages, exchange_shops: exchangeShops } = rawData;
    const market = createMarket(packages, exchangeShops, items, limitOptions, marketOptions, locale);
    const result = buildPurchasePlan(market, currencyItemId, currencyCost, null);
    return result.fullyReachable ? result.totalCost : NaN;
}

// Banknote cost of each successive CUMULATIVE amount of `currencyItemId`, given `increments` in
// the order they should accumulate (e.g. each bonus tier's threshold gap, lowest first). Unlike
// `independentPurchaseCost` above, a bonus tier is a genuinely cumulative milestone (the reward
// for having spent/earned a running total in this shop), so each step's cost has to reflect
// currency already committed to reaching the PREVIOUS tier: re-solves the full running total
// from a fresh market each step (rather than depleting one shared, already-mutated ledger
// increment by increment, which would round up — and waste the leftover — on every single step)
// and takes the difference from the previous step's total. Returns a same-length array of step
// costs (Banknotes), with `NaN` for any step whose cumulative total exceeds what's obtainable at
// all (every step from there on is `NaN` too, since the total only grows).
function cumulativeStepCosts(currencyItemId, increments, limitOptions, marketOptions, locale) {
    const { items, packages, exchange_shops: exchangeShops } = rawData;
    const costs = [];
    let cumulative = 0;
    let previousCost = 0;
    let reachable = true;
    for (const increment of increments) {
        cumulative += increment;
        if (reachable) {
            const market = createMarket(packages, exchangeShops, items, limitOptions, marketOptions, locale);
            const result = buildPurchasePlan(market, currencyItemId, cumulative, null);
            reachable = result.fullyReachable;
            if (reachable) {
                costs.push(result.totalCost - previousCost);
                previousCost = result.totalCost;
                continue;
            }
        }
        costs.push(NaN);
    }
    return costs;
}

// How many times `offer` can be bought within the selected Days horizon. "Exceed event limits"
// never applies here: it exists only to model buying MORE of the real-money packages that sell
// an event's currency, never the in-shop offers that SPEND it — an offer's own purchase limit
// always applies, same as `pricing-core.js`'s `createMarket`/`collectExchangeSources` (see their
// own comments for the same rule).
function offerMaxQuantity(offerRaw, shop, limitOptions) {
    return effectiveCapacity(offerRaw.purchase_limit, offerRaw.limit_type, Boolean(shop.event_id), limitOptions);
}

// Banknote cost for every offer/bonus tier of `shop` (the same capacity-aware machinery
// `analyze.html` uses under the hood, via `independentPurchaseCost`/`cumulativeStepCosts`
// above). Every offer always starts fresh at zero, as if it were the only thing being bought —
// see `independentPurchaseCost`. Bonus tiers instead share one running cumulative currency
// budget across all of a shop's tiers (see `cumulativeStepCosts`) — two different player
// questions that shouldn't be conflated.
//
// Also computes, per offer, the cost of buying all the way up to ITS OWN purchase limit
// (`offerMaxCosts`, keyed the same way as `offerCosts`): a cheap, small-`currency_cost` offer's
// single-purchase cost is dominated almost entirely by which currency package tier you had to
// round up to, not by anything specific to that offer, since one purchase only ever uses a
// sliver of a package's yield. Buying up to the purchase limit spreads that same package cost
// over as many as a few thousand purchases instead, converging toward the offer's real
// underlying value-per-currency-unit — see `attachMaxRatios` for how this turns into a ratio.
function computeCosts(shop, limitOptions, marketOptions, locale) {
    const offerCosts = new Map();
    const offerMaxCosts = new Map();
    for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
        offerCosts.set(
            offerKey,
            independentPurchaseCost(shop.currency_item_id, offer.currency_cost, limitOptions, marketOptions, locale),
        );

        const maxQuantity = offerMaxQuantity(offer, shop, limitOptions);
        const maxCost = Number.isFinite(maxQuantity)
            ? independentPurchaseCost(
                  shop.currency_item_id,
                  maxQuantity * offer.currency_cost,
                  limitOptions,
                  marketOptions,
                  locale,
              )
            : NaN;
        offerMaxCosts.set(offerKey, { quantity: maxQuantity, cost: maxCost });
    }

    const thresholds = Object.keys(shop.bonus_tiers || {})
        .map(Number)
        .filter((threshold) => Number.isFinite(threshold) && threshold > 0)
        .sort((a, b) => a - b);
    let previousThreshold = 0;
    const gaps = thresholds.map((threshold) => {
        const gap = threshold - previousThreshold;
        previousThreshold = threshold;
        return gap;
    });
    const tierStepCosts = cumulativeStepCosts(shop.currency_item_id, gaps, limitOptions, marketOptions, locale);
    const bonusTierStepCosts = new Map(thresholds.map((threshold, index) => [String(threshold), tierStepCosts[index]]));

    return { offerCosts, offerMaxCosts, bonusTierStepCosts };
}

// Attaches `max_quantity`/`max_cost`/`max_value`/`max_ratio` to every offer row, using
// `offerMaxCosts` (see `computeCosts`). A known-priced reward's value scales exactly linearly
// with how many are bought, so `max_value` is just `total_value * quantity`; an "exclusive"
// reward with no known market price of its own (`!value_complete`) has its single-purchase
// value defined as whatever was left of the price after paying for the rest of the bundle (see
// `valueOfBundle` in ranking-core.js) — since an offer is always a single-item bundle, that
// residual is simply the full price, so at max scale it's likewise just whatever `max_cost` came
// out to (a ratio of exactly 1, same as at single-purchase scale — buying more doesn't change
// how "known" an item is). Every field is `NaN` (rendered "N/A") when the purchase limit is
// unbounded or unreachable.
function attachMaxRatios(shopId, offers, offerMaxCosts) {
    for (const row of offers) {
        const offerKey = row.id.slice(shopId.length + 1);
        const { quantity, cost } = offerMaxCosts.get(offerKey) || {};
        const reachable = Number.isFinite(quantity) && Number.isFinite(cost) && cost > 0;
        row.max_quantity = quantity;
        row.max_cost = reachable ? cost : NaN;
        row.max_value = reachable ? (row.value_complete ? row.total_value * quantity : cost) : NaN;
        row.max_ratio = reachable ? Number((row.max_value / row.max_cost).toFixed(4)) : NaN;
    }
}

function recompute() {
    itemsById = rawData.items || {};
    eligibleEvents = computeEligibleEvents(rawData);
    populateEventSelect();

    if (eligibleEvents.length === 0) {
        offersPrompt.hidden = true;
        offersWrap.hidden = true;
        offersEmpty.hidden = false;
        bonusTiersSection.hidden = true;
        return;
    }

    const eventId = eventSelect.value;
    const hasEvent = eligibleEvents.some((event) => event.id === eventId);

    if (exceedPackLimitsCheckbox) {
        exceedPackLimitsCheckbox.disabled = !hasEvent;
        if (!hasEvent) {
            exceedPackLimitsCheckbox.checked = false;
        }
    }

    if (!hasEvent) {
        offersEmpty.hidden = true;
        offersWrap.hidden = true;
        offersPrompt.hidden = false;
        bonusTiersSection.hidden = true;
        return;
    }
    offersEmpty.hidden = true;
    offersPrompt.hidden = true;

    const locale = getLocale();
    const { exchange_shops: exchangeShops = {} } = rawData;
    const [, shop] = Object.entries(exchangeShops).find(([, s]) => s.event_id === eventId);

    const limitOptions = { days: Number(daysInput ? daysInput.value : 1) || 1 };
    const marketOptions = {
        activeEventIds: new Set([eventId]),
        exceedEventPackLimits: Boolean(exceedPackLimitsCheckbox?.checked),
    };
    const { offerCosts, offerMaxCosts, bonusTierStepCosts } = computeCosts(shop, limitOptions, marketOptions, locale);

    const result = buildEventOffers(rawData, eventId, locale, {
        useNaiveFallback: fallbackCheckbox.checked,
        offerCosts,
        bonusTierStepCosts,
    });
    attachMaxRatios(result.shopId, result.offers, offerMaxCosts);

    offersWrap.hidden = false;
    const currencyName = localizedName(itemsById[result.currencyItemId]?.name, locale) || result.currencyItemId;
    renderOffers(result.offers, currencyName);
    renderBonusTiers(result.bonusTiers);
}

async function init() {
    rawData = await loadPackData();
    withLoadingOverlay(recompute);

    eventSelect.addEventListener('change', () => {
        expandedRowKeys.clear();
        withLoadingOverlay(recompute);
    });
    daysInput.addEventListener('input', () => withLoadingOverlay(recompute));
    daysInput.addEventListener('change', () => withLoadingOverlay(recompute));
    exceedPackLimitsCheckbox.addEventListener('change', () => withLoadingOverlay(recompute));
    fallbackCheckbox.addEventListener('change', () => withLoadingOverlay(recompute));

    window.addEventListener('localechange', () => {
        applyStaticTranslations();
        withLoadingOverlay(recompute);
    });
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
