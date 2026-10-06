import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { buildValuation, modelSummaryText } from './lib/valuation';
import { mountValuationPanel } from './lib/valuation-panel';
import { withLoading } from './lib/loading';
import { packageWeeklyCapacity, isSeasonalOff } from './lib/catalog.js';
import { packageDisplayName, itemDisplayName, purchaseType } from './lib/labels';
import { createItemImage, banknoteIconHtml } from './lib/images';
import { enableInfoTooltips } from './lib/tooltip';
import { requiresIconHtml, infoIconHtml } from './lib/requires-tooltip';
import { t, getLocale, categoryLabel, sourceTypeLabel, formatDays, applyStaticTranslations } from './lib/i18n';
import { formatThousands, formatSignificant, computeTieFlags } from './lib/format';
import { ratioBarHtml } from './lib/ratio-bar';

renderNav('rankings');
applyStaticTranslations();

const searchInput = document.getElementById('search-input');
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
 * "Buy" cell: how many the best plan for your weekly spend buys out of what's on sale this week,
 * e.g. "3 / 7", "1 / month" (monthly pass), "2 / ∞" (no limit). Lifetime-limited packs aren't part of
 * the weekly plan: "once" / "3× total". "doesn't fit" marks a good deal (ratio clearly above 1.0) the
 * plan leaves out because whole purchases don't fit your exact spend.
 */
function buyHtml(entry) {
    const { planned, capacity, limitType } = entry;
    if (limitType === 'lifetime') {
        return capacity === 1 ? t('rankings.once') : t('rankings.lifetimeTotal', { count: formatThousands(capacity) });
    }
    const count = limitType === 'monthly' ? Math.round(planned / capacity) : Math.round(planned);
    const countHtml = count > 0 ? `<span class="buy-badge">×${formatThousands(count)}</span>` : '0';
    let limit = Number.isFinite(capacity) ? formatThousands(capacity) : '∞';
    if (limitType === 'monthly') {
        limit = t('rankings.perMonth');
    }
    if (count === 0 && entry.rank && entry.ratio > 1.005) {
        return `<span class="text-dim">${t('rankings.buyNoFit')}</span>`;
    }
    return `${countHtml}&nbsp;<span class="text-dim">/&nbsp;${limit}</span>`;
}

/**
 * Every package and pass on sale this week, ranked by ratio. Entries containing items of unknown
 * worth can't be compared, so they're listed after the ranking. Exchange-shop offers live on the
 * Events page.
 */
function buildEntries() {
    const locale = getLocale();
    // Everything on sale this week: packages of switched-off events are hidden; lifetime-limited packs
    // are listed even though they don't count toward the weekly plan.
    const activeEventIds = new Set(settings.activeEvents);
    const capacityRules = { activeEventIds, includePasses: true, includeExclusives: true };
    const planned = new Map(valuation.plan.purchases.map((p) => [p.id, p.count]));
    const result = [];
    for (const [id, pkg] of Object.entries(data.packages)) {
        if (
            !(pkg.price > 0) ||
            (pkg.event_id && !activeEventIds.has(pkg.event_id)) ||
            isSeasonalOff(id, pkg, settings.seasonalPass)
        ) {
            continue;
        }
        const b = valuation.bundle(pkg, pkg.price);
        result.push({
            key: `package:${id}`,
            section: b.incomplete ? 'unknown' : 'ranked',
            type: purchaseType(pkg),
            category: pkg.category,
            name: packageDisplayName(pkg, locale),
            requires: pkg.requires,
            availableDays: pkg.available_days,
            priceHtml: gold(formatThousands(pkg.price)),
            planned: planned.get(id) || 0,
            capacity: packageWeeklyCapacity(pkg, capacityRules),
            limitType: pkg.limit_type,
            worth: b.worth,
            ratio: b.ratio,
            parts: b.parts,
        });
    }

    const ranked = result
        .filter((entry) => entry.section === 'ranked' && Number.isFinite(entry.ratio))
        .sort((a, b) => b.ratio - a.ratio)
        .map((entry, index) => ({ rank: index + 1, ...entry }));
    const unknown = result.filter((entry) => entry.section === 'unknown').sort((a, b) => a.name.localeCompare(b.name));
    return [...ranked, ...unknown];
}

function ratioHtml(entry, maxRatio) {
    if (entry.section === 'unknown') {
        return t('common.dash');
    }
    return ratioBarHtml(entry.ratio, maxRatio, { digits: 3 });
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
                <div class="ranking-grid__row${entry.planned > 1e-6 ? ' ranking-grid__row--buy' : ''}" role="row">
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${entry.rank && !tieFlags[index] ? entry.rank : ''}</div>
                    <div class="ranking-grid__cell" role="cell">${entry.name}${requiresIconHtml(entry.requires, data.packages, data.items, getLocale())}</div>
                    <div class="ranking-grid__cell" role="cell"><span class="pill pill--${entry.type}">${sourceTypeLabel(entry.type)}</span></div>
                    <div class="ranking-grid__cell" role="cell">${categoryLabel(entry.category)}${entry.availableDays?.length ? infoIconHtml(formatDays(entry.availableDays)) : ''}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${entry.priceHtml}</div>
                    <div class="ranking-grid__cell ranking-grid__cell--num" role="cell">${buyHtml(entry)}</div>
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
