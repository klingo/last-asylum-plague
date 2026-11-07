/**
 * The event's exchange shop: offers by unlock stage with their ratios and locks ("must buy"), the bonus tiers
 * and the note on what the locks cost.
 */
import { planOptions } from '../../ui/valuation.js';
import { solveWeeklyPlan } from '../../core/planner.js';
import { getSettings, updateSettings } from '../../ui/settings.js';
import { offerWeeklyCapacity } from '../../core/catalog.js';
import { hasOtherSource as itemHasOtherSource } from '../../core/item-sources.js';
import { activeLocks, withLock } from '../../core/event-plan.js';
import { itemDisplayName, itemLinkName, bundleLabel } from '../../ui/labels.js';
import { banknotesAmount, buyBadge, hydrateItemIcons } from '../../ui/html.js';
import { gridHeader, gridRow, gridTable, gridSection } from '../../ui/grid.js';
import { enableInfoTooltips } from '../../ui/tooltip.js';
import { infoIconHtml } from '../../ui/info-icon.js';
import { t, tHtml, getLocale, localizedName } from '../../ui/i18n.js';
import { formatThousands } from '../../ui/format.js';
import { ratioCellHtml, ratioScale } from '../../ui/ratio-bar.js';
import { ctx } from './state.js';
import { WIDE, cell, headerCell, iconHtml, numCell } from './cells.js';
import { overridesKey, pageOverrides, selection } from './context.js';
import { lockNote, shopHeading, shopNote, shopSection, shopTable } from './elements.js';

// itemId -> whether any pack or another shop gives it (for the "Only here" badge), per shop.
const otherSourceCache = new Map();

/** Shop offers grouped by unlock stage (unlock amount once per group); rows the plan buys stand out. */
function renderShop({ shopId, shop }) {
    shopSection.hidden = !shop;
    if (!shop) {
        return;
    }
    const locale = getLocale();
    const plan = ctx.valuation.plan;
    const coinWorth = ctx.valuation.worth(shop.currency_item_id);
    shopHeading.textContent = localizedName(shop.name, locale);
    shopNote.hidden = !shop.random_offers;
    const bought = new Map(plan.exchanges.filter((e) => e.shopId === shopId).map((e) => [e.offerKey, e.count]));
    const offers = Object.entries(shop.offers || {}).map(([offerKey, offer]) => {
        const b = ctx.valuation.bundle({ contains: { [offer.item_id]: offer.quantity } }, 0);
        return {
            offerKey,
            offer,
            count: bought.get(offerKey) || 0,
            worth: b.worth,
            ratio: coinWorth > 0 && !b.incomplete ? b.worth / (offer.currency_cost * coinWorth) : null,
        };
    });
    const maxRatio = ratioScale(offers.map((o) => o.ratio));
    // Banknote amounts: whole numbers for event shops; the VIP Shop's are small, so 1 decimal (2 below 1).
    const smallest = Math.min(
        ...offers.flatMap((o) => [o.worth, o.offer.currency_cost * coinWorth]).filter((x) => x > 0),
    );
    const decimals = shop.event_id ? 0 : smallest < 1 ? 2 : 1;
    const bn = (value) => banknotesAmount(value, decimals);
    const stages = [...new Set(offers.map((o) => o.offer.unlock_points || 0))].sort((a, b) => a - b);
    const coinIcon = iconHtml(shop.currency_item_id);
    // Random offers (Recluse Merchant): no weekly count, just whether an offer is worth its coins when it shows up.
    const worthBuying = (o) => (shop.random_offers ? o.ratio >= 1 : o.count > 0);
    const buyCell = (o) => {
        if (shop.random_offers) {
            return o.ratio === null
                ? ''
                : o.ratio >= 1
                  ? buyBadge(t('events.buy'))
                  : `<span class="text-dim">${tHtml('events.skip')}</span>`;
        }
        return o.count ? buyBadge(`×${formatThousands(o.count)}`) : '';
    };

    // Most purchases per week (daily limits also shown per day, e.g. "7 (1/day)").
    const limitHtml = (offer) => {
        const perWeek = formatThousands(offerWeeklyCapacity(offer, shop));
        return offer.limit_type === 'daily'
            ? `${perWeek}&nbsp;<span class="text-dim">(${tHtml('events.perDay', { count: formatThousands(offer.purchase_limit) })})</span>`
            : perWeek;
    };
    // "Must buy" locks (not for random offers, which can't be planned).
    const lockable = !shop.random_offers;
    const lockCell = (offerKey, offer) => {
        const key = `${shopId}:${offerKey}`;
        const isFixed = key in (getSettings().lockedOffers || {});
        const count = isFixed ? getSettings().lockedOffers[key] : 0;
        const limit = offerWeeklyCapacity(offer, shop);
        const toggle = `<button type="button" class="lock-toggle" data-lock="${offerKey}" aria-pressed="${isFixed}" title="${tHtml('events.lock')}" aria-label="${tHtml('events.lock')}">${isFixed ? '🔒' : '🔓'}</button>`;
        const amount = isFixed
            ? `<input type="number" class="lock-count" data-lock-count="${offerKey}" min="0" max="${limit}" step="1" value="${Math.min(count, limit)}" title="${tHtml('events.lockCount')}" aria-label="${tHtml('events.lockCount')}" />`
            : '';
        // Count first, lock on the right; right-aligned like the other number columns.
        return numCell(`<span class="lock-cell">${amount}${toggle}</span>`);
    };
    const onlyHereBadge = (offer) =>
        hasOtherSource(shopId, offer.item_id)
            ? ''
            : ` <span class="only-here" title="${tHtml('events.onlyHereHint')}">${tHtml('events.onlyHere')}</span>`;

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
                            `${iconHtml(offer.item_id)}<span>${itemLinkName(ctx.data.items, offer.item_id, locale)} ×${formatThousands(offer.quantity)}${onlyHereBadge(offer)}</span>`,
                            'item-cell',
                        ),
                        numCell(limitHtml(offer), WIDE),
                        numCell(`${formatThousands(offer.currency_cost)} ${coinIcon}`),
                        numCell(coinWorth > 0 ? bn(offer.currency_cost * coinWorth) : t('common.dash'), WIDE),
                        numCell(bn(worth), WIDE),
                        numCell(ratioCellHtml(ratio, maxRatio)),
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
            const b = ctx.valuation.bundle({ contains: reward }, 0);
            const firstItem = Object.keys(reward)[0];
            return gridRow(
                [
                    cell(
                        `${iconHtml(firstItem)}${tHtml('events.bonusTier', { threshold: formatThousands(threshold) })}: ${bundleLabel(reward, ctx.data.items, locale)}`,
                        'item-cell',
                    ),
                    numCell(t('common.dash'), WIDE),
                    numCell(t('common.dash')),
                    numCell(t('common.dash'), WIDE),
                    numCell(bn(b.worth), WIDE),
                    numCell(''),
                    lockable ? numCell('') : '',
                    numCell(reached.has(threshold) ? buyBadge(`✓ ${tHtml('events.reached')}`) : ''),
                ],
                { buy: reached.has(threshold) },
            );
        });

    const header = gridRow([
        headerCell('events.table.offer'),
        headerCell('common.table.limit', true, true),
        headerCell('events.table.cost', true),
        // The Banknote cost is derived (coins × what a coin is worth), not a price: say so.
        gridHeader(`${infoIconHtml(t('events.costBanknotesInfo'))}${tHtml('events.table.costBanknotes')}`, {
            num: true,
            wide: true,
        }),
        headerCell('common.table.worth', true, true),
        headerCell('common.table.ratio', true),
        lockable ? headerCell('events.table.mustBuy', true) : '',
        headerCell(shop.random_offers ? 'events.table.buyIfOffered' : 'common.table.buy', true),
    ]);
    shopTable.innerHTML = gridTable(
        header,
        `${groups.join('')}${tierRows.length > 0 ? `${gridSection(tHtml('events.bonusSection'))}${tierRows.join('')}` : ''}`,
    );
    shopTable.classList.toggle('events-shop-grid--locks', lockable);
    hydrateItemIcons(shopTable);
    enableInfoTooltips(shopTable);
    wireLocks(shopId, shop);
}

/** Saves the "Must buy" locks of the shop table (the whole weekly plan follows them). */
function wireLocks(shopId, shop) {
    // `count` null = unlock; 0 = never buy; otherwise exactly that many per week.
    const save = (offerKey, count) =>
        updateSettings({ lockedOffers: withLock(getSettings().lockedOffers, shopId, offerKey, count) });
    shopTable.querySelectorAll('[data-lock]').forEach((button) => {
        button.addEventListener('click', () => {
            const offerKey = button.dataset.lock;
            const locked = `${shopId}:${offerKey}` in (getSettings().lockedOffers || {});
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

/** Whether any pack (nested) or another shop's offer gives the item (no "Only here" badge then), per shop. */
function hasOtherSource(shopId, itemId) {
    const cacheKey = `${shopId}:${itemId}`;
    if (!otherSourceCache.has(cacheKey)) {
        otherSourceCache.set(cacheKey, itemHasOtherSource(ctx.data, shopId, itemId));
    }
    return otherSourceCache.get(cacheKey);
}

/**
 * "Your N locked offers cost about X Banknotes of worth": the plan without the locks minus the plan
 * with them (one extra solve, cached per settings); a warning instead if the locks don't fit the spend.
 * Shown on the tab of a shop with locks; other tabs only say which shops' locks share the weekly spend.
 */
function renderLockNote() {
    const shops = ctx.data.exchange_shops || {};
    const active = activeLocks(getSettings().lockedOffers, shops, getSettings().activeEvents);
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
    const cacheKey = `${JSON.stringify(getSettings())}|${overridesKey()}`;
    if (ctx.lockCostCache.key !== cacheKey) {
        const unlocked = solveWeeklyPlan(
            ctx.valuation.highs,
            ctx.data,
            planOptions(ctx.data, getSettings(), { ...overrides, lockedOffers: {} }),
        );
        ctx.lockCostCache = {
            key: cacheKey,
            cost: (unlocked.totalPoints - ctx.valuation.plan.totalPoints) / ctx.valuation.rate,
        };
    }
    const parts = [
        `<span class="text-dim">${tHtml('events.lockCost', {
            count: formatThousands(active.length),
            worth: formatThousands(Math.max(0, ctx.lockCostCache.cost), 0),
        })}</span>`,
    ];
    // Fixed amounts the spend can't fully cover: the plan bought as many as possible.
    const shortfalls = ctx.valuation.plan.lockShortfalls || [];
    if (shortfalls.length > 0) {
        const items = shortfalls.map(({ key, wanted, got }) => {
            const [shopId, offerKey] = key.split(':');
            const offer = shops[shopId]?.offers?.[offerKey];
            return tHtml('events.lockShortfallItem', {
                item: offer ? itemDisplayName(ctx.data.items, offer.item_id, getLocale()) : offerKey,
                got: formatThousands(got),
                wanted: formatThousands(wanted),
            });
        });
        parts.push(`<span class="text-warn">${tHtml('events.lockShortfall', { items: items.join(', ') })}</span>`);
    }
    lockNote.className = '';
    lockNote.innerHTML = parts.join(' ');
}

export { renderLockNote, renderShop };
