import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { buildValuation, modelSummaryText } from './lib/valuation';
import { mountValuationPanel } from './lib/valuation-panel';
import { withLoading } from './lib/loading';
import { isSeasonalOff, packageWeeklyCapacity } from './lib/catalog.js';
import { createUnitCounter, isContainerItem, isValueLevel, itemChainTops } from './lib/item-sources.js';
import { createItemPicker } from './lib/item-picker';
import { packageDisplayName, itemDisplayName, escapeHtml } from './lib/labels';
import { createItemImage, banknoteIconHtml } from './lib/images';
import { formatThousands, formatSignificant } from './lib/format';
import { ratioBarHtml } from './lib/ratio-bar';
import { infoIconHtml } from './lib/requires-tooltip';
import { enableInfoTooltips } from './lib/tooltip';
import { t, getLocale, localizedName, applyStaticTranslations } from './lib/i18n';

renderNav('sources');
applyStaticTranslations();

const itemPicker = createItemPicker({
    trigger: document.getElementById('item-search'),
    onChange: () => {
        render();
        syncUrl();
    },
});
const sourcesPrompt = document.getElementById('sources-prompt');
const sourcesEmpty = document.getElementById('sources-empty');
const sourcesMeta = document.getElementById('sources-meta');
const sourcesTable = document.getElementById('sources-table');

let data = null;
let settings = null;
let valuation = null;
let baseItems = {};
// Top item of a crafting chain (Tempered Steel) -> its base (Cloth), whose units are counted.
let chainBaseOf = new Map();

const gold = (text) => `<span class="text-gold">${text}</span> ${banknoteIconHtml()}`;
const iconHtml = (itemId) => `<span data-item-id="${itemId}"></span>`;
const amount = (value) => (Number.isInteger(value) ? formatThousands(value) : formatSignificant(value));

/**
 * Banknotes that `amount` coins (or diamonds) cost: bought from the packs on sale that give them, the
 * cheapest per coin first, each only as often as it can be bought per week (its whole price counted for the
 * coins). { banknotes, packIds } or null if no pack on sale gives them.
 */
function coinCost(currencyId, amount, activeEventIds) {
    const packs = Object.entries(data.packages)
        .filter(
            ([id, pkg]) =>
                pkg.price > 0 && pkg.contains?.[currencyId] > 0 && !isSeasonalOff(id, pkg, settings.seasonalPasses),
        )
        .map(([id, pkg]) => ({
            id,
            rate: pkg.price / pkg.contains[currencyId],
            coinsPerWeek: packageWeeklyCapacity(pkg, { activeEventIds }) * pkg.contains[currencyId],
        }))
        .filter((pack) => pack.coinsPerWeek > 0)
        .sort((a, b) => a.rate - b.rate);
    if (packs.length === 0) {
        return null;
    }
    let banknotes = 0;
    let remaining = amount;
    const packIds = [];
    for (const pack of packs) {
        const coins = Math.min(remaining, pack.coinsPerWeek);
        banknotes += coins * pack.rate;
        remaining -= coins;
        packIds.push(pack.id);
        if (remaining <= 0) {
            break;
        }
    }
    // More than every pack gives per week: the rest at the dearest pack's rate.
    banknotes += Math.max(0, remaining) * packs[packs.length - 1].rate;
    return { banknotes, packIds };
}

/**
 * Every purchase on sale this week that gives the target item, at any depth: packages (packs of
 * ticked events and seasonal passes on sale) and exchange-shop offers (VIP Shop, shops of ticked
 * events). Per source: units per purchase, its price in Banknotes (shop offers at what their coins cost, see
 * coinCost; coins no pack sells at their worth in the plan),
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
        if (
            !(pkg.price > 0) ||
            (pkg.event_id && !activeEventIds.has(pkg.event_id)) ||
            isSeasonalOff(id, pkg, settings.seasonalPasses)
        ) {
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
            const cost = coinCost(shop.currency_item_id, offer.currency_cost, activeEventIds);
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
    })} ${modelSummaryText(valuation)}`;
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
    const cell = (html, extra = '') => `<div class="ranking-grid__cell ${extra}" role="cell">${html}</div>`;
    const num = (html) => cell(html, 'ranking-grid__cell--num');
    const header = (key, isNum = false) =>
        `<div class="ranking-grid__cell ranking-grid__cell--header${isNum ? ' ranking-grid__cell--num' : ''}" role="columnheader">${t(`sources.table.${key}`)}</div>`;
    const perUnitHeader = `<div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${unitScale === 1 ? t('sources.table.perUnit') : t('sources.table.perUnits', { count: formatThousands(unitScale) })}</div>`;
    const rows = sources.map((s, index) => {
        // Items in the source that lead to the target only nested (e.g. Resource Supply (SR) for Herbs),
        // in small grey text under the source's name.
        const via = s.via.length
            ? `<span class="source-via">${t('sources.via', {
                  items: s.via.map((id) => itemDisplayName(data.items, id, locale)).join(', '),
              })}</span>`
            : '';
        return `<div class="ranking-grid__row${s.bought ? ' ranking-grid__row--buy' : ''}" role="row">
            ${num(s.perUnit === null ? '' : formatThousands(index + 1))}
            ${cell(`${s.iconId ? iconHtml(s.iconId) : ''}<span class="source-name"><span>${s.nameHtml}</span>${via}</span>`, 'item-cell')}
            ${num(`${s.random ? '~' : ''}×${amount(s.units)}`)}
            ${num(s.priceHtml)}
            ${num(s.perUnit === null ? t('common.dash') : gold(formatSignificant(s.perUnit * unitScale)))}
            ${num(s.ratio === null ? t('common.dash') : ratioBarHtml(s.ratio, maxRatio, { digits: 3 }))}
            ${num(shareHtml(s.share))}
            ${num(s.itemRatio === null ? t('common.dash') : ratioBarHtml(s.itemRatio, maxItemRatio, { digits: 3 }))}
        </div>`;
    });
    sourcesTable.innerHTML = `
        <div class="ranking-grid__row" role="row">
            ${header('rank', true)}${header('source')}${header('gives', true)}${header('price', true)}${perUnitHeader}${header('ratio', true)}${header('share', true)}${header('itemRatio', true)}
        </div>
        ${rows.join('')}`;
    sourcesTable.querySelectorAll('[data-item-id]').forEach((placeholder) => {
        const itemId = placeholder.getAttribute('data-item-id');
        placeholder.replaceWith(createItemImage(itemId, itemId, 'item-icon item-icon--sm'));
    });
    enableInfoTooltips(sourcesTable);
}

function syncUrl() {
    const url = new URL(window.location.href);
    const params = new URLSearchParams();
    const lang = url.searchParams.get('lang');
    if (lang) {
        params.set('lang', lang);
    }
    if (itemPicker.getValue()) {
        params.set('item', itemPicker.getValue());
    }
    window.history.replaceState(null, '', `${url.pathname}${params.size ? `?${params}` : ''}${url.hash}`);
}

async function recompute() {
    await withLoading(async () => {
        valuation = await buildValuation(data, settings);
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
    // Only base items: a container (e.g. Herb Level Supply) just stands for what it contains, and its
    // contents are found through it anyway (pick Herbs to see every pack with Herb Level Supplies).
    // Crafting chains appear once, as their top item (Tempered Steel, not Cloth). Value levels (Lv.1 /
    // Lv.3 / Lv.5 Sharp Beak: worth 9:1, but not convertible) are listed each, with their own sources.
    const chainTops = itemChainTops(data.items, { convertibleOnly: true });
    chainBaseOf = new Map([...chainTops].map(([baseId, topId]) => [topId, baseId]));
    baseItems = Object.fromEntries(
        Object.entries(data.items)
            .filter(([id, item]) => !isContainerItem(item) || chainBaseOf.has(id) || isValueLevel(item))
            .filter(([id]) => !chainTops.has(id)),
    );
    itemPicker.setItems(baseItems);
    const itemParam = new URLSearchParams(window.location.search).get('item');
    if (itemParam && baseItems[itemParam]) {
        itemPicker.setValue(itemParam);
    }
    window.addEventListener('localechange', () => {
        applyStaticTranslations();
        itemPicker.setItems(baseItems);
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
