import { startPage } from '../ui/page.js';
import { buildValuation } from '../ui/valuation.js';
import { urlParam, setUrlParams } from '../ui/url.js';
import { mountValuationPanel } from '../ui/valuation-panel.js';
import { getSettings, onSettingsChange } from '../ui/settings.js';
import { withLoading } from '../ui/loading.js';
import { isOnSale, currencyCost } from '../core/catalog.js';
import { createUnitCounter, sourcesListing } from '../core/item-sources.js';
import { createItemPicker } from '../ui/item-picker.js';
import { packageDisplayName, itemDisplayName } from '../ui/labels.js';
import { escapeHtml, banknotesHtml, itemIconSlot, hydrateItemIcons } from '../ui/html.js';
import { gridCell, gridNum, gridHeader, gridRow, gridTable } from '../ui/grid.js';
import { formatThousands, formatSignificant } from '../ui/format.js';
import { ratioBarHtml } from '../ui/ratio-bar.js';
import { infoIconHtml } from '../ui/info-icon.js';
import { enableInfoTooltips } from '../ui/tooltip.js';
import { t, tHtml, getLocale, localizedName } from '../ui/i18n.js';

const itemPicker = createItemPicker({
    trigger: document.getElementById('item-search'),
    onChange: () => {
        render();
        setUrlParams({ item: itemPicker.getValue() });
    },
});
const sourcesPrompt = document.getElementById('sources-prompt');
const sourcesEmpty = document.getElementById('sources-empty');
const sourcesMeta = document.getElementById('sources-meta');
const sourcesTable = document.getElementById('sources-table');

let data = null;
let settings = null;
let valuation = null;
let panel = null;
let baseItems = {};
// Top item of a crafting chain (Tempered Steel) -> its base (Cloth), whose units are counted.
let chainBaseOf = new Map();

const gold = banknotesHtml;
const iconHtml = itemIconSlot;
const amount = (value) => (Number.isInteger(value) ? formatThousands(value) : formatSignificant(value));

/**
 * Every purchase on sale this week that gives the target item, at any depth: packages (packs of
 * ticked events and seasonal passes on sale) and exchange-shop offers (VIP Shop, shops of ticked
 * events). Per source: units per purchase, its price in Banknotes (shop offers at what their coins cost, see
 * currencyCost in catalog.js; coins no pack sells at their worth in the plan),
 * Banknotes per unit, the item's share of the source's worth and the source's ratio (its whole worth
 * ÷ price, as on the Ranking).
 */
function buildSources(targetId) {
    const locale = getLocale();
    // A crafting chain's top item (Tempered Steel) counts everything down to its base (Cloth), converted
    // at the crafting rate (256 Cloth = 1 Tempered Steel).
    const countId = chainBaseOf.get(targetId) ?? targetId;
    const counter = createUnitCounter(data.items, countId);
    const perTarget = countId === targetId ? 1 : counter.ofItem(targetId).units;
    const unitsOf = (r) => ({ units: r.units / perTarget, random: r.random });
    const unitWorth = valuation.worth(targetId);
    const activeEventIds = new Set(settings.activeEvents);
    const plannedPackages = new Set(valuation.plan.purchases.map((p) => p.id));
    const plannedOffers = new Set(valuation.plan.exchanges.map((e) => `${e.shopId}:${e.offerKey}`));
    // Items in a bundle that lead to the target only nested (for the grey "via" line).
    const viaOf = (contents, choice) =>
        [
            ...new Set([
                ...Object.keys(contents || {}),
                ...(choice?.choices || []).flatMap((option) => Object.keys(option)),
            ]),
        ].filter((id) => id !== targetId && id !== countId && counter.ofItem(id).units > 0);
    const sources = [];
    const add = (source) => {
        const perUnit = source.price > 0 && source.units > 0 ? source.price / source.units : null;
        // Share of the source's worth that is this item (capped: picks/expected amounts can round past 100 %).
        const share =
            unitWorth !== null && source.worth > 0 ? Math.min(1, (source.units * unitWorth) / source.worth) : null;
        const ratio = source.price > 0 && !source.incomplete ? source.worth / source.price : null;
        // Worth of just this item ÷ price (≈ ratio × share); ranking by per-unit price ranks by this too.
        const itemRatio = unitWorth !== null && source.price > 0 ? (source.units * unitWorth) / source.price : null;
        sources.push({ ...source, perUnit, share, ratio, itemRatio });
    };

    for (const [id, pkg] of Object.entries(data.packages)) {
        if (!isOnSale(id, pkg, { activeEventIds, seasonalPasses: settings.seasonalPasses })) {
            continue;
        }
        const { units, random } = unitsOf(counter.ofBundle(pkg));
        if (units > 0) {
            const b = valuation.bundle(pkg, pkg.price);
            add({
                worth: b.worth,
                incomplete: b.incomplete,
                key: `package:${id}`,
                nameHtml: packageDisplayName(pkg, locale),
                via: viaOf(pkg.contains, pkg.choice),
                units,
                random,
                priceHtml: gold(formatThousands(pkg.price)),
                price: pkg.price,
                bought: plannedPackages.has(id),
            });
        }
    }

    for (const [shopId, shop] of Object.entries(data.exchange_shops || {})) {
        if (shop.event_id && !activeEventIds.has(shop.event_id)) {
            continue;
        }
        const coinWorth = valuation.worth(shop.currency_item_id);
        for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
            const per = unitsOf(counter.ofItem(offer.item_id));
            if (!(per.units > 0)) {
                continue;
            }
            const b = valuation.bundle({ contains: { [offer.item_id]: offer.quantity } }, 0);
            const cost = currencyCost(data.packages, shop.currency_item_id, offer.currency_cost, {
                activeEventIds,
                seasonalPasses: settings.seasonalPasses,
            });
            const price = cost ? cost.banknotes : coinWorth > 0 ? offer.currency_cost * coinWorth : 0;
            // How the Banknote price came about, as an info icon next to the coin price.
            const priceInfo =
                price > 0
                    ? infoIconHtml(
                          cost
                              ? t('sources.coinCost', {
                                    amount: formatThousands(price, 0),
                                    packs: cost.packIds
                                        .map((id) => packageDisplayName(data.packages[id], locale))
                                        .join(', '),
                                })
                              : t('sources.coinWorth', { amount: formatThousands(price, 0) }),
                      )
                    : '';
            add({
                worth: b.worth,
                incomplete: b.incomplete,
                key: `offer:${shopId}:${offerKey}`,
                iconId: offer.item_id,
                // Shop and item only: the amount is in the Gives column.
                nameHtml: `${escapeHtml(localizedName(shop.name, locale))} - ${itemDisplayName(data.items, offer.item_id, locale)}`,
                via: [], // the offer's name already says which item it is
                units: per.units * offer.quantity,
                random: per.random,
                priceHtml: `<span class="price-info">${priceInfo}</span>${formatThousands(offer.currency_cost)} ${iconHtml(shop.currency_item_id)}`,
                price,
                bought: plannedOffers.has(`${shopId}:${offerKey}`),
            });
        }
    }

    // Cheapest per unit first; sources without a Banknote price (coins of no worth) last.
    return sources.sort((a, b) => (a.perUnit ?? Infinity) - (b.perUnit ?? Infinity));
}

/** "31 %" share of a source's worth that is the selected item ("<1 %" for traces). */
function shareHtml(share) {
    if (share === null) {
        return t('common.dash');
    }
    return share > 0 && share < 0.01 ? '&lt;1&nbsp;%' : `${formatThousands(share * 100, 0)}&nbsp;%`;
}

function render() {
    const targetId = itemPicker.getValue();
    sourcesPrompt.hidden = Boolean(targetId);
    if (!targetId || !valuation) {
        sourcesEmpty.hidden = true;
        sourcesMeta.hidden = true;
        sourcesTable.innerHTML = '';
        return;
    }
    const locale = getLocale();
    const sources = buildSources(targetId);
    sourcesEmpty.hidden = sources.length > 0;
    sourcesMeta.hidden = sources.length === 0;
    const unitWorth = valuation.worth(targetId);
    sourcesMeta.textContent = `${t('sources.summary', {
        count: formatThousands(sources.length),
        item: localizedName(data.items[targetId].name, locale),
        worth: unitWorth === null ? t('common.unknown') : formatSignificant(unitWorth),
    })}`;
    if (sources.length === 0) {
        sourcesTable.innerHTML = '';
        return;
    }

    const maxRatio = Math.max(1, ...sources.map((s) => s.ratio).filter(Number.isFinite));
    const maxItemRatio = Math.max(1, ...sources.map((s) => s.itemRatio).filter(Number.isFinite));
    // Bulk items cost tiny fractions of a Banknote each: price per 1,000 / 1,000,000 / ... units instead.
    const cheapest = Math.min(...sources.map((s) => s.perUnit).filter(Number.isFinite));
    let unitScale = 1;
    while (cheapest * unitScale < 1 && unitScale < 1e12) {
        unitScale *= 1000;
    }
    const cell = (html, className = '') => gridCell(html, { className });
    const num = gridNum;
    // Gives, Share and Item ratio are hidden on phones.
    const WIDE = { wide: true };
    const header = (key, isNum = false, wide = false) => gridHeader(t(`sources.table.${key}`), { num: isNum, wide });
    const perUnitHeader = gridHeader(
        unitScale === 1
            ? t('sources.table.perUnit')
            : t('sources.table.perUnits', { count: formatThousands(unitScale) }),
        { num: true },
    );
    const rows = sources.map((s, index) => {
        // Items in the source that lead to the target only nested (e.g. Resource Supply (SR) for Herbs),
        // in small grey text under the source's name.
        const via = s.via.length
            ? `<span class="source-via">${tHtml('sources.via', {
                  items: s.via.map((id) => itemDisplayName(data.items, id, locale)).join(', '),
              })}</span>`
            : '';
        return gridRow(
            [
                num(s.perUnit === null ? '' : formatThousands(index + 1)),
                cell(
                    `${s.iconId ? iconHtml(s.iconId) : ''}<span class="source-name"><span>${s.nameHtml}</span>${via}</span>`,
                    'item-cell',
                ),
                num(`${s.random ? '~' : ''}×${amount(s.units)}`, WIDE),
                num(s.priceHtml),
                num(s.perUnit === null ? t('common.dash') : gold(formatSignificant(s.perUnit * unitScale))),
                num(s.ratio === null ? t('common.dash') : ratioBarHtml(s.ratio, maxRatio, { digits: 3 })),
                num(shareHtml(s.share), WIDE),
                num(
                    s.itemRatio === null ? t('common.dash') : ratioBarHtml(s.itemRatio, maxItemRatio, { digits: 3 }),
                    WIDE,
                ),
            ],
            { buy: s.bought },
        );
    });
    const headerRow = gridRow([
        header('rank', true),
        header('source'),
        header('gives', true, true),
        header('price', true),
        perUnitHeader,
        header('ratio', true),
        header('share', true, true),
        header('itemRatio', true, true),
    ]);
    sourcesTable.innerHTML = gridTable(headerRow, rows.join(''));
    hydrateItemIcons(sourcesTable);
    enableInfoTooltips(sourcesTable);
}

async function recompute() {
    await withLoading(async () => {
        valuation = await buildValuation(data, settings);
        panel.showRate(valuation);
        render();
    });
}

async function init(loaded) {
    data = loaded;
    settings = getSettings();
    panel = mountValuationPanel(document.getElementById('valuation-panel'), data, {
        fields: ['budget', 'events', 'passes'],
    });
    onSettingsChange((next) => {
        settings = next;
        recompute();
    });
    // Only base items (see sourcesListing): containers stand for their contents, crafting chains appear as their
    // top item, value levels each.
    const listing = sourcesListing(data.items);
    chainBaseOf = listing.chainBaseOf;
    baseItems = Object.fromEntries([...listing.listed].map((id) => [id, data.items[id]]));
    itemPicker.setItems(baseItems);
    const itemParam = urlParam('item');
    if (itemParam && baseItems[itemParam]) {
        itemPicker.setValue(itemParam);
    }
    await recompute();
}

startPage('sources', {
    init,
    onLocaleChange() {
        itemPicker.setItems(baseItems);
        render();
    },
});
