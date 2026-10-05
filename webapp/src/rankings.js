import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { buildValuation, modelSummaryText } from './lib/valuation';
import { mountValuationPanel } from './lib/valuation-panel';
import { withLoading } from './lib/loading';
import { packageWeeklyCapacity, offerWeeklyCapacity, isUnavailablePass } from './lib/catalog.js';
import { packageDisplayName, itemDisplayName, offerDisplayName, purchaseType } from './lib/labels';
import { createItemImage, banknoteIconHtml } from './lib/images';
import { enableInfoTooltips } from './lib/tooltip';
import { requiresIconHtml, infoIconHtml } from './lib/requires-tooltip';
import {
    t,
    getLocale,
    localizedName,
    categoryLabel,
    sourceTypeLabel,
    formatDays,
    applyStaticTranslations,
} from './lib/i18n';
import { formatThousands, formatSignificant, computeTieFlags } from './lib/format';
import { ratioBarHtml } from './lib/ratio-bar';

renderNav('rankings');
applyStaticTranslations();

const searchInput = document.getElementById('search-input');
const includeExchangeShopsCheckbox = document.getElementById('include-exchange-shops');
const rankingMeta = document.getElementById('ranking-meta');
const rankingTable = document.getElementById('ranking-table');
const rankingEmpty = document.getElementById('ranking-empty');

let data = null;
let settings = null;
let valuation = null;
let entries = [];
const expandedKeys = new Set();

const gold = (text) => `<span class="text-gold">${text}</span> ${banknoteIconHtml()}`;

/**
 * How many of an entry the best plan for your weekly spend buys: "×N", "1 / month" for the monthly
 * pass (the plan counts 7/30 of it per week), "doesn't fit" for a good deal (ratio clearly above 1.0) the
 * plan leaves out because whole purchases don't fit the exact spend, or ''.
 */
function buyHtml(count, entry) {
    if (!(count > 1e-6)) {
        return entry.rank && entry.ratio > 1.005 ? `<span class="text-dim">${t('rankings.buyNoFit')}</span>` : '';
    }
    const whole = Math.round(count);
    const text = Math.abs(count - whole) < 1e-6 ? `×${formatThousands(whole)}` : t('rankings.buyMonthly');
    return `<span class="text-good">${text}</span>`;
}

/** How much can go into an entry per week: "once", "unlimited" or an amount. */
function perWeekHtml(capacity, limitType, amountHtml) {
    if (limitType === 'exclusive' || limitType === 'event') {
        return t('rankings.once');
    }
    if (!Number.isFinite(capacity)) {
        return t('common.unlimited');
    }
    return amountHtml(capacity);
}

/**
 * Every rankable purchase: packages, plus exchange offers and shop bonus tiers when enabled.
 * Only complete, purchasable entries get a rank; bonus tiers come free with spending coins and
 * entries containing items of unknown worth can't be compared, so both are listed after them.
 */
function buildEntries() {
    const locale = getLocale();
    // Everything on sale this week: packages of switched-off events are hidden; once-only packs are
    // listed (as "once") even though they don't count toward the weekly market.
    const activeEventIds = new Set(settings.activeEvents);
    const unavailablePasses = new Set(settings.unavailablePasses);
    const capacityRules = { activeEventIds, includePasses: true, includeExclusives: true };
    const result = [];
    const planned = new Map(valuation.plan.purchases.map((p) => [`package:${p.id}`, p.count]));
    for (const e of valuation.plan.exchanges) {
        planned.set(`exchange:${e.shopId}:${e.offerKey}`, e.count);
    }

    for (const [id, pkg] of Object.entries(data.packages)) {
        if (
            !(pkg.price > 0) ||
            (pkg.event_id && !activeEventIds.has(pkg.event_id)) ||
            isUnavailablePass(id, pkg, unavailablePasses)
        ) {
            continue;
        }
        const b = valuation.bundle(pkg, pkg.price);
        const capacity = packageWeeklyCapacity(pkg, capacityRules);
        result.push({
            key: `package:${id}`,
            section: b.incomplete ? 'unknown' : 'ranked',
            type: purchaseType(pkg),
            category: pkg.category,
            name: packageDisplayName(pkg, locale),
            requires: pkg.requires,
            availableDays: pkg.available_days,
            priceHtml: gold(formatThousands(pkg.price)),
            perWeekHtml: perWeekHtml(capacity, pkg.limit_type, (n) => gold(formatThousands(n * pkg.price, 0))),
            worth: b.worth,
            ratio: b.ratio,
            parts: b.parts,
        });
    }

    if (includeExchangeShopsCheckbox.checked) {
        for (const [shopId, shop] of Object.entries(data.exchange_shops || {})) {
            if (shop.event_id && !activeEventIds.has(shop.event_id)) {
                continue;
            }
            const coinWorth = valuation.worth(shop.currency_item_id);
            if (!(coinWorth > 0)) {
                continue; // currency without a worth (or in surplus): nothing to compare against
            }
            const coinName = itemDisplayName(data.items, shop.currency_item_id, locale);
            for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
                const b = valuation.bundle({ contains: { [offer.item_id]: offer.quantity } }, 0);
                const paid = offer.currency_cost * coinWorth;
                const capacity = offerWeeklyCapacity(offer, shop);
                result.push({
                    key: `exchange:${shopId}:${offerKey}`,
                    section: b.incomplete ? 'unknown' : 'ranked',
                    type: 'exchange_offer',
                    category: shop.event_id ? 'event_exchange' : 'exchange',
                    name: offerDisplayName(shop, offer, data.items, locale),
                    priceHtml: `${formatThousands(offer.currency_cost)} ${coinName}`,
                    perWeekHtml: perWeekHtml(
                        capacity,
                        offer.limit_type,
                        (n) => `${formatThousands(n * offer.currency_cost, 0)} ${coinName}`,
                    ),
                    worth: b.worth,
                    ratio: b.worth / paid,
                    parts: b.parts,
                });
            }
            let previous = 0;
            for (const threshold of Object.keys(shop.bonus_tiers || {})
                .map(Number)
                .sort((a, b) => a - b)) {
                const step = threshold - previous;
                previous = threshold;
                const b = valuation.bundle({ contains: shop.bonus_tiers[String(threshold)] }, 0);
                result.push({
                    key: `bonus:${shopId}:${threshold}`,
                    section: 'bonus',
                    type: 'bonus_tier',
                    category: 'event_exchange',
                    name: `${localizedName(shop.name, locale)} - ${t('rankings.bonusTierName', { threshold: formatThousands(threshold) })}`,
                    priceHtml: `${formatThousands(step)} ${coinName}`,
                    perWeekHtml: t('common.dash'),
                    worth: b.worth,
                    // Bonus on top of what the step's coins already buy.
                    ratio: b.worth / (step * coinWorth),
                    parts: b.parts,
                });
            }
        }
    }

    const ranked = result
        .filter((entry) => entry.section === 'ranked' && Number.isFinite(entry.ratio))
        .sort((a, b) => b.ratio - a.ratio)
        .map((entry, index) => ({ rank: index + 1, ...entry }));
    const others = (section) =>
        result
            .filter((entry) => entry.section === section)
            .sort((a, b) => (b.ratio || 0) - (a.ratio || 0) || a.name.localeCompare(b.name));
    return [...ranked, ...others('bonus'), ...others('unknown')].map((entry) => ({
        ...entry,
        buy: planned.get(entry.key) || 0,
    }));
}

function ratioHtml(entry, maxRatio) {
    if (entry.section === 'bonus') {
        return `+${formatThousands(entry.ratio * 100, 1)}%`;
    }
    if (entry.section === 'unknown') {
        return t('common.dash');
    }
    return ratioBarHtml(entry.ratio, maxRatio);
}

function breakdownRowsHtml(entry) {
    const locale = getLocale();
    return entry.parts
        .map((part) => ({ ...part, worth: part.qty * (valuation.worth(part.id) ?? 0) }))
        .sort((a, b) => b.worth - a.worth)
        .map(
            (part) => `
                <div class="ranking-grid__row">
                    <div class="ranking-grid__cell"></div>
                    <div class="ranking-grid__cell item-cell"><span class="breakdown-icon" data-item-id="${part.id}"></span>${itemDisplayName(data.items, part.id, locale)} &times;${formatSignificant(part.qty)}</div>
                    <div class="ranking-grid__cell"></div>
                    <div class="ranking-grid__cell">${categoryLabel(data.items[part.id]?.category)}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num">${formatSignificant(valuation.points(part.id)) ?? t('common.unknown')}</div>
                    <div class="ranking-grid__cell"></div>
                    <div class="ranking-grid__cell"></div>
                    <div class="ranking-grid__cell ranking-grid__cell--num">${gold(formatSignificant(part.worth))}</div>
                    <div class="ranking-grid__cell">${valuation.worth(part.id) === null ? `<span class="text-bad">${t('rankings.table.incomplete')}</span>` : ''}</div>
                    <div class="ranking-grid__cell"></div>
                </div>`,
        )
        .join('');
}

function renderTable(filtered) {
    rankingEmpty.hidden = filtered.length > 0;
    if (filtered.length === 0) {
        rankingTable.innerHTML = '';
        return;
    }
    const tieFlags = computeTieFlags(filtered.map((entry) => (entry.rank ? entry.ratio.toFixed(4) : entry.key)));
    const maxRatio = Math.max(1, ...filtered.filter((entry) => entry.rank).map((entry) => entry.ratio));
    let lastSection = null;
    const rows = filtered
        .map((entry, index) => {
            const heading =
                entry.section !== lastSection && entry.section !== 'ranked'
                    ? `<div class="ranking-grid__section">${t(`rankings.section.${entry.section}`)}</div>`
                    : '';
            lastSection = entry.section;
            return `${heading}
                <div class="ranking-grid__row" role="row">
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${entry.rank && !tieFlags[index] ? entry.rank : ''}</div>
                    <div class="ranking-grid__cell" role="cell">${entry.name}${requiresIconHtml(entry.requires, data.packages, data.items, getLocale())}</div>
                    <div class="ranking-grid__cell" role="cell"><span class="pill pill--${entry.type}">${sourceTypeLabel(entry.type)}</span></div>
                    <div class="ranking-grid__cell" role="cell">${categoryLabel(entry.category)}${entry.availableDays?.length ? infoIconHtml(formatDays(entry.availableDays)) : ''}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${entry.priceHtml}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${entry.perWeekHtml}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${buyHtml(entry.buy, entry)}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${gold(formatThousands(entry.worth, 0))}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${ratioHtml(entry, maxRatio)}</div>
                    <div class="ranking-grid__cell" role="cell"><button type="button" class="expand-toggle" data-entry-key="${entry.key}">${expandedKeys.has(entry.key) ? t('common.hide') : t('common.details')}</button></div>
                </div>
                <div class="ranking-grid__details" data-entry-key-details="${entry.key}" ${expandedKeys.has(entry.key) ? '' : 'hidden'}>
                    <div class="ranking-grid__row">
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header">${t('rankings.table.item')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header">${t('rankings.table.category')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num">${t('rankings.table.pointsEach')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num">${t('rankings.table.worth')}</div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                        <div class="ranking-grid__cell ranking-grid__cell--header"></div>
                    </div>
                    ${breakdownRowsHtml(entry)}
                </div>`;
        })
        .join('');

    rankingTable.innerHTML = `
        <div class="ranking-grid__row" role="row">
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('rankings.table.rank')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">${t('rankings.table.name')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">${t('rankings.table.type')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader">${t('rankings.table.category')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('rankings.table.price')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('rankings.table.perWeek')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('rankings.table.buy')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('rankings.table.worth')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header ranking-grid__cell--num" role="columnheader">${t('rankings.table.ratio')}</div>
            <div class="ranking-grid__cell ranking-grid__cell--header" role="columnheader"></div>
        </div>
        ${rows}`;

    rankingTable.querySelectorAll('[data-item-id]').forEach((placeholder) => {
        const itemId = placeholder.getAttribute('data-item-id');
        placeholder.replaceWith(createItemImage(itemId, itemId, 'item-icon item-icon--sm'));
    });
    enableInfoTooltips(rankingTable);
    rankingTable.querySelectorAll('.expand-toggle').forEach((button) => {
        button.addEventListener('click', () => {
            const key = button.getAttribute('data-entry-key');
            const details = rankingTable.querySelector(`[data-entry-key-details="${key}"]`);
            details.hidden = !details.hidden;
            button.textContent = details.hidden ? t('common.details') : t('common.hide');
            if (details.hidden) {
                expandedKeys.delete(key);
            } else {
                expandedKeys.add(key);
            }
        });
    });
}

function applyFilters() {
    const search = searchInput.value.trim().toLowerCase();
    renderTable(
        entries.filter(
            (entry) => !search || `${entry.name} ${categoryLabel(entry.category)}`.toLowerCase().includes(search),
        ),
    );
}

function rebuild() {
    entries = buildEntries();
    const rankedCount = entries.filter((entry) => entry.rank).length;
    const plan = valuation.plan;
    rankingMeta.textContent = `${t('rankings.planSummary', {
        purchases: formatThousands(plan.purchases.length),
        spent: formatThousands(plan.spent, 0),
        budget: formatThousands(plan.budget, 0),
        exchanges: formatThousands(plan.exchanges.length),
    })} ${t('rankings.meta', { count: rankedCount })} ${modelSummaryText(valuation)}`;
    applyFilters();
}

async function recompute() {
    await withLoading(async () => {
        valuation = await buildValuation(data, settings);
        rebuild();
    });
}

async function init() {
    data = await loadPackData();
    const panel = mountValuationPanel(document.getElementById('valuation-panel'), data, {
        onChange: (next) => {
            settings = next;
            recompute();
        },
    });
    settings = panel.getSettings();
    searchInput.addEventListener('input', applyFilters);
    includeExchangeShopsCheckbox.addEventListener('change', rebuild);
    window.addEventListener('localechange', () => {
        applyStaticTranslations();
        rebuild();
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
