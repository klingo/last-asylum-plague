import { startPage } from '../ui/page.js';
import { buildValuation, modelSummaryText } from '../ui/valuation.js';
import { mountValuationPanel } from '../ui/valuation-panel.js';
import { getSettings, onSettingsChange } from '../ui/settings.js';
import { withLoading } from '../ui/loading.js';
import { packageWeeklyCapacity, isOnSale, purchaseType } from '../core/catalog.js';
import { packageDisplayName, packageDisplayText } from '../ui/labels.js';
import { banknotesHtml, hydrateItemIcons } from '../ui/html.js';
import {
    gridCell,
    gridNum,
    gridHeader,
    gridRow,
    gridSection,
    gridDetails,
    detailsToggleHtml,
    wireDetailsToggles,
    breakdownParts,
} from '../ui/grid.js';
import { enableInfoTooltips } from '../ui/tooltip.js';
import { requiresIconHtml, infoIconHtml } from '../ui/info-icon.js';
import { t, getLocale, enumLabel, formatDays } from '../ui/i18n.js';
import { formatThousands, computeTieFlags } from '../ui/format.js';
import { ratioBarHtml } from '../ui/ratio-bar.js';

const searchInput = document.getElementById('search-input');
const rankingMeta = document.getElementById('ranking-meta');
const rankingTable = document.getElementById('ranking-table');
const rankingEmpty = document.getElementById('ranking-empty');

let data = null;
let settings = null;
let valuation = null;
let entries = [];
const expandedKeys = new Set();

/**
 * "Buy" cell: how many the best plan for your weekly spend buys out of what's on sale this week,
 * e.g. "3 / 7", "1 / month" (monthly pass), "1 / 2 weeks" (biweekly pass), "2 / ∞" (no limit). Lifetime-limited packs aren't part of
 * the weekly plan: "once" / "3× total". "doesn't fit" marks a good deal (ratio clearly above 1.0) the
 * plan leaves out because whole purchases don't fit your exact spend.
 */
function buyHtml(entry) {
    const { planned, capacity, limitType } = entry;
    if (limitType === 'lifetime') {
        return capacity === 1 ? t('rankings.once') : t('rankings.lifetimeTotal', { count: formatThousands(capacity) });
    }
    // Monthly / biweekly passes: the plan counts a weekly share; show whole purchases per period.
    const periodic = limitType === 'monthly' || limitType === 'biweekly';
    const count = periodic ? Math.round(planned / capacity) : Math.round(planned);
    const countHtml = count > 0 ? `<span class="buy-badge">×${formatThousands(count)}</span>` : '0';
    let limit = Number.isFinite(capacity) ? formatThousands(capacity) : '∞';
    if (limitType === 'monthly') {
        limit = t('rankings.perMonth');
    } else if (limitType === 'biweekly') {
        limit = t('rankings.perTwoWeeks');
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
        if (!isOnSale(id, pkg, { activeEventIds, seasonalPasses: settings.seasonalPasses })) {
            continue;
        }
        const b = valuation.bundle(pkg, pkg.price);
        const capacity = packageWeeklyCapacity(pkg, capacityRules);
        // Monthly / biweekly purchases count at their weekly share (7/30, 7/14 of the price) in the weekly plan.
        const weeklyShare =
            pkg.limit_type === 'monthly' || pkg.limit_type === 'biweekly'
                ? `<span class="price-info">${infoIconHtml(t('rankings.perWeekShare', { amount: formatThousands(capacity * pkg.price, 0) }))}</span>`
                : '';
        result.push({
            key: `package:${id}`,
            section: b.incomplete ? 'unknown' : 'ranked',
            type: purchaseType(pkg),
            category: pkg.category,
            name: packageDisplayName(pkg, locale),
            requires: pkg.requires,
            availableDays: pkg.available_days,
            priceHtml: `${weeklyShare}${banknotesHtml(formatThousands(pkg.price))}`,
            planned: planned.get(id) || 0,
            capacity,
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

/** The Details block: the package's contents in the table's columns. */
function detailsHtml(entry) {
    const header = gridRow([
        gridHeader(),
        gridHeader(t('rankings.table.item')),
        gridHeader(),
        gridHeader(t('rankings.table.category')),
        gridHeader(t('rankings.table.pointsEach'), { num: true }),
        gridHeader(),
        gridHeader(t('rankings.table.worth'), { num: true }),
        gridHeader(),
        gridHeader(),
    ]);
    const rows = breakdownParts(entry.parts, data, valuation).map((part) =>
        gridRow([
            gridCell(),
            gridCell(part.item, { className: 'item-cell' }),
            gridCell(),
            gridCell(part.category),
            gridNum(part.points),
            gridCell(),
            gridNum(part.worth),
            gridCell(part.unknown ? `<span class="text-bad">${t('rankings.table.incomplete')}</span>` : ''),
            gridCell(),
        ]),
    );
    return gridDetails(entry.key, expandedKeys, header + rows.join(''));
}

function renderTable(filtered) {
    rankingEmpty.hidden = filtered.length > 0;
    if (filtered.length === 0) {
        rankingTable.innerHTML = '';
        return;
    }
    const locale = getLocale();
    const tieFlags = computeTieFlags(filtered.map((entry) => (entry.rank ? entry.ratio.toFixed(4) : entry.key)));
    const maxRatio = Math.max(1, ...filtered.filter((entry) => entry.rank).map((entry) => entry.ratio));
    let lastSection = null;
    const rows = filtered.map((entry, index) => {
        const heading =
            entry.section !== lastSection && entry.section !== 'ranked'
                ? gridSection(t(`rankings.section.${entry.section}`))
                : '';
        lastSection = entry.section;
        const row = gridRow(
            [
                gridNum(entry.rank && !tieFlags[index] ? entry.rank : ''),
                gridCell(`${entry.name}${requiresIconHtml(entry.requires, data.packages, data.items, locale)}`),
                gridCell(`<span class="pill pill--${entry.type}">${enumLabel('sourceType', entry.type)}</span>`),
                gridCell(
                    `${enumLabel('category', entry.category)}${entry.availableDays?.length ? infoIconHtml(formatDays(entry.availableDays)) : ''}`,
                ),
                gridNum(entry.priceHtml),
                gridNum(buyHtml(entry)),
                gridNum(banknotesHtml(formatThousands(entry.worth, 0))),
                gridNum(ratioHtml(entry, maxRatio)),
                gridCell(detailsToggleHtml(entry.key, expandedKeys)),
            ],
            { buy: entry.planned > 1e-6 },
        );
        return `${heading}${row}${detailsHtml(entry)}`;
    });

    const header = gridRow([
        gridHeader(t('rankings.table.rank'), { num: true }),
        gridHeader(t('rankings.table.name')),
        gridHeader(t('rankings.table.type')),
        gridHeader(t('rankings.table.category')),
        gridHeader(t('rankings.table.price'), { num: true }),
        gridHeader(t('rankings.table.buy'), { num: true }),
        gridHeader(t('rankings.table.worth'), { num: true }),
        gridHeader(t('rankings.table.ratio'), { num: true }),
        gridHeader(),
    ]);
    rankingTable.innerHTML = header + rows.join('');
    hydrateItemIcons(rankingTable);
    enableInfoTooltips(rankingTable);
    wireDetailsToggles(rankingTable, expandedKeys);
}

function applyFilters() {
    const search = searchInput.value.trim().toLowerCase();
    renderTable(
        entries.filter(
            (entry) =>
                !search || `${entry.name} ${enumLabel('category', entry.category)}`.toLowerCase().includes(search),
        ),
    );
}

function rebuild() {
    entries = buildEntries();
    const rankedCount = entries.filter((entry) => entry.rank).length;
    const plan = valuation.plan;
    const monthly = plan.purchases
        .filter((p) => p.pkg.limit_type === 'monthly' || p.pkg.limit_type === 'biweekly')
        .map((p) => packageDisplayText(p.pkg, getLocale()));
    const monthlyNote = monthly.length > 0 ? ` ${t('rankings.monthlyNote', { names: monthly.join(', ') })}` : '';
    rankingMeta.textContent = `${t('rankings.planSummary', {
        purchases: formatThousands(plan.purchases.length),
        spent: formatThousands(plan.spent, 0),
        budget: formatThousands(plan.budget, 0),
    })}${monthlyNote} ${t('rankings.meta', { count: rankedCount })} ${modelSummaryText(valuation)}`;
    applyFilters();
}

async function recompute() {
    await withLoading(async () => {
        valuation = await buildValuation(data, settings);
        rebuild();
    });
}

startPage('rankings', {
    async init(loaded) {
        data = loaded;
        settings = getSettings();
        mountValuationPanel(document.getElementById('valuation-panel'), data);
        onSettingsChange((next) => {
            settings = next;
            recompute();
        });
        searchInput.addEventListener('input', applyFilters);
        await recompute();
    },
    onLocaleChange: rebuild,
});
