/**
 * "Your plan": one tile per step of the selected event (mine verdict, packs, coins, pickaxes, Encounters,
 * bonus tiers, everything it gives).
 */
import { eventItemTotals } from '../../core/event-plan.js';
import { eventPackSpend, eventPurchases } from '../../core/step-analysis.js';
import { packageDisplayName, itemDisplayName, itemLinkName, bundleLabel } from '../../ui/labels.js';
import { banknotesAmount, escapeAttr, hydrateItemIcons, tileHtml } from '../../ui/html.js';
import { enableInfoTooltips } from '../../ui/tooltip.js';
import { t, tHtml, getLocale } from '../../ui/i18n.js';
import { formatAmount, formatThousands } from '../../ui/format.js';
import { ctx } from './state.js';
import { iconHtml } from './cells.js';
import { extraFor, minePlan } from './context.js';
import { eventSummary } from './elements.js';
import { mineVerdictTile, pickaxeTile } from './mine.js';

/**
 * A currency's tile: received from the packs (the event's packs one by one, so the total adds up), from
 * elsewhere (the page's extra amount) and spent (`spentKey`: where).
 */
function currencyTile(currencyId, spentKey, { eventId = null } = {}) {
    const locale = getLocale();
    const coin = ctx.valuation.plan.currencies.get(currencyId);
    const received = coin?.received ?? 0;
    const line = (label, qty) => `<li><span>${label}</span><span>${formatThousands(qty, 0)}</span></li>`;
    const packLines = eventPurchases(ctx.valuation.plan, eventId)
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
        itemDisplayName(ctx.data.items, currencyId, locale),
        `<div class="plan-stat">${iconHtml(currencyId)}<strong>${formatThousands(received, 0)}</strong> ${tHtml('events.received')}</div>
        ${packLines.length > 0 ? `<ul class="plan-list">${packLines.map(([label, qty]) => line(label, qty)).join('')}</ul>` : ''}
        ${coin?.extra ? `<div class="plan-stat">+ <strong>${formatThousands(coin.extra, 0)}</strong> ${tHtml('events.extra')}</div>` : ''}
        <div class="plan-stat text-dim">${formatThousands(coin?.spent ?? 0, 0)} ${tHtml(spentKey)}</div>`,
    );
}

/** "Your plan": one tile per step — the mine's verdict, packs to buy, coins, pickaxes, Encounters, bonus tiers. */
function renderSummary({ eventId, shopId, shop, mineId, mine }) {
    const locale = getLocale();
    const plan = ctx.valuation.plan;
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
                ? `<div class="plan-tile__note text-dim">${tHtml('events.extraBanknotesNote', {
                      used: formatThousands(plan.eventExtraUsed, 0),
                      amount: formatThousands(extraFor(eventId), 0),
                  })}</div>`
                : '';
        const body =
            purchases.length > 0
                ? `<ul class="plan-list">${purchases
                      .map(
                          (p) =>
                              `<li><span>${packageDisplayName(p.pkg, locale)} <strong>×${formatThousands(p.count)}</strong></span><span>${banknotesAmount(p.spend)}</span></li>`,
                      )
                      .join('')}</ul>${
                      purchases.length > 1
                          ? `<div class="plan-tile__total">${tHtml('common.total')} ${banknotesAmount(eventPackSpend(plan, eventId))}</div>`
                          : ''
                  }${extraNote}`
                : `<span class="text-dim">${tHtml('events.summaryNoPacks')}</span>${extraNote}`;
        tiles.push(tileHtml(tHtml('events.tiles.packs'), body));
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
                    <div class="plan-stat text-dim">+${formatThousands(pointPurchase.count * points)} ${tHtml('events.points')}</div>`,
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
                            const tip = escapeAttr(bundleLabel(shop.bonus_tiers[String(x)], ctx.data.items, locale));
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
                t('common.everything'),
                `<ul class="item-list">${totals
                    .map(
                        ({ id, qty, worth }) =>
                            `<li><span class="item-chip">${iconHtml(id)}${itemLinkName(ctx.data.items, id, locale)}</span><strong class="${qty < 0 ? 'text-bad' : ''}">${qty < 0 ? '−' : '×'}${formatAmount(Math.abs(qty))}</strong><span>${banknotesAmount(worth)}</span></li>`,
                    )
                    .join('')}</ul>
                <div class="plan-tile__total">${tHtml('common.totalWorth')} ${banknotesAmount(totalWorth)}</div>`,
                true,
            ),
        );
    }
    eventSummary.innerHTML = tiles.join('');
    hydrateItemIcons(eventSummary);
    enableInfoTooltips(eventSummary);
}

/** Every item the plan gets from the event, sorted by worth (event-plan.js `eventItemTotals`). */
function itemTotals({ eventId, shopId, shop, mineId, mine }) {
    return eventItemTotals(
        ctx.valuation.plan,
        { eventId, shopId, shop, mine, dug: mine ? minePlan(mineId) : null },
        { partsOf: (pkg) => ctx.valuation.bundle(pkg, 0).parts, worthOf: (id) => ctx.valuation.worth(id) },
    );
}

export { renderSummary };
