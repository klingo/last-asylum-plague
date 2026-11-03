import { startPage } from '../ui/page.js';
import { buildValuation } from '../ui/valuation.js';
import { mountValuationPanel } from '../ui/valuation-panel.js';
import { getSettings, updateSettings, onSettingsChange } from '../ui/settings.js';
import { gameDay } from '../core/schedule.js';
import { skipUntilDay, activeSkips, expandSkips } from '../core/skips.js';
import { formatGameDay } from '../ui/event-banner.js';
import { withLoading } from '../ui/loading.js';
import { packageWeeklyCapacity, isOnSale, purchaseType, bundledPairs } from '../core/catalog.js';
import { packageDisplayName, packageDisplayText } from '../ui/labels.js';
import { banknotesHtml, escapeHtml, hydrateItemIcons } from '../ui/html.js';
import {
    gridCell,
    gridNum,
    gridHeader,
    gridRow,
    gridTable,
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
const showMode = document.getElementById('show-mode');
const typeFilter = document.getElementById('type-filter');
const rankingMeta = document.getElementById('ranking-meta');
const rankingTable = document.getElementById('ranking-table');
const rankingEmpty = document.getElementById('ranking-empty');

let data = null;
let settings = null;
let valuation = null;
let panel = null;
let entries = [];
const expandedKeys = new Set();
// Filters of this page (not saved): everything or only what the plan buys, and the Type pills shown (none = all).
let planOnly = false;
const shownTypes = new Set();

/** The Buy cell with "for the bonus tiers" on a second line. */
const withTiersNote = (html) =>
    `<span class="buy-stack"><span>${html}</span><span class="buy-note text-dim">${t('rankings.buyForTiers')}${infoIconHtml(t('rankings.buyForTiersTip'))}</span></span>`;

/**
 * "Buy" cell: how many the best plan for your weekly spend buys out of what's on sale this week,
 * e.g. "3 / 7", "1 / month" (monthly pass), "1 / 2 weeks" (biweekly pass), "2 / ∞" (no limit). Lifetime-limited packs aren't part of
 * the weekly plan: "once" / "3× total". A pack the plan leaves out says why when it isn't just the spend:
 * "in Weekly Pass" (a bundle the plan buys includes it), "other pick" (only one of its group can be bought).
 * "doesn't fit" marks a good deal (ratio clearly above 1.0) left out because whole purchases don't fit your
 * exact spend. A pack bought below ratio 1.0 for a shop's bonus tiers says so ("for the bonus tiers").
 */
function buyCountHtml(entry) {
    const { planned, capacity, limitType } = entry;
    if (limitType === 'lifetime') {
        return capacity === 1 ? t('rankings.once') : t('rankings.lifetimeTotal', { count: formatThousands(capacity) });
    }
    // Monthly / biweekly passes: the plan counts a weekly share; show whole purchases per period.
    const periodic = limitType === 'monthly' || limitType === 'biweekly';
    const count = periodic ? Math.round(planned / capacity) : Math.round(planned);
    if (count === 0 && entry.notBought) {
        const { kind, name } = entry.notBought;
        const [label, tip] =
            kind === 'bundle'
                ? [t('rankings.buyInBundle', { name }), t('rankings.buyInBundleTip', { name })]
                : [t('rankings.buyOtherInGroup'), t('rankings.buyOtherInGroupTip', { name })];
        return `<span class="text-dim">${label}</span>${infoIconHtml(tip)}`;
    }
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
    const html = `${countHtml}<span class="text-dim buy-limit">&nbsp;/&nbsp;${limit}</span>`;
    return count > 0 && entry.forTiers ? withTiersNote(html) : html;
}

/** The small Skip button of a pack the plan buys (the plan is made again without it, see core/skips.js). */
function skipButtonHtml(entry) {
    const label = escapeHtml(t('rankings.skipLabel', { name: entry.plainName }));
    return `<button type="button" class="skip-btn" data-skip="${entry.packageId}" aria-label="${label}">${t('rankings.skip')}</button>`;
}

/**
 * A skipped pack in the Buy cell: "Skipped" with when the skip ends, or, for a higher tier carried along by the skip
 * of a lower one, with why.
 */
function skippedHtml(entry) {
    const note =
        entry.skipCause === entry.packageId
            ? t('rankings.skippedUntil', { date: formatGameDay(entry.skipUntil) })
            : t('rankings.skippedNeeds', { name: entry.causeName });
    return `<span class="text-dim">${t('rankings.skipped')}</span>${infoIconHtml(note)}`;
}

/** The Buy cell: skipped, or how many the plan buys. */
function buyHtml(entry) {
    return entry.skipCause ? skippedHtml(entry) : buyCountHtml(entry);
}

/** The Skip column: Skip on a pack the plan buys, Undo on a pack skipped by name (a tier carried along has none). */
function skipCellHtml(entry) {
    if (entry.skipCause) {
        return entry.skipCause === entry.packageId
            ? `<button type="button" class="skip-btn" data-unskip="${entry.packageId}">${t('rankings.undo')}</button>`
            : '';
    }
    return entry.planned > 1e-6 ? skipButtonHtml(entry) : '';
}

/**
 * Why the plan leaves packages out although they're on sale, beyond the spend: package id ->
 * `{ kind: 'bundle' | 'group', name }` (the bundle that includes it / the member of its group bought instead).
 */
function notBoughtReasons(planned, locale) {
    const reasons = new Map();
    for (const [bundleId, includedId] of bundledPairs(data.packages)) {
        if (planned.has(bundleId)) {
            reasons.set(includedId, { kind: 'bundle', name: packageDisplayName(data.packages[bundleId], locale) });
        }
    }
    const boughtInGroup = new Map();
    for (const id of planned.keys()) {
        const group = data.packages[id]?.exclusive_group;
        if (group) {
            boughtInGroup.set(group, id);
        }
    }
    for (const [id, pkg] of Object.entries(data.packages)) {
        const boughtId = pkg.exclusive_group && boughtInGroup.get(pkg.exclusive_group);
        if (boughtId && boughtId !== id && !reasons.has(id)) {
            reasons.set(id, { kind: 'group', name: packageDisplayName(data.packages[boughtId], locale) });
        }
    }
    return reasons;
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
    const reasons = notBoughtReasons(planned, locale);
    // The packs skipped (still running), and the higher tiers the skip takes along: package id -> the one that causes it.
    const skipCauses = expandSkips(activeSkips(settings.skippedPackages, gameDay(new Date()).day), data.packages);
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
            packageId: id,
            plainName: packageDisplayText(pkg, locale),
            skipCause: skipCauses.get(id) || null,
            causeName: skipCauses.has(id) ? packageDisplayName(data.packages[skipCauses.get(id)], locale) : null,
            skipUntil: settings.skippedPackages?.[id],
            section: b.incomplete ? 'unknown' : 'ranked',
            type: purchaseType(pkg),
            category: pkg.category,
            name: packageDisplayName(pkg, locale),
            requires: pkg.requires,
            availableDays: pkg.available_days,
            priceHtml: `${weeklyShare}${banknotesHtml(formatThousands(pkg.price))}`,
            planned: planned.get(id) || 0,
            notBought: reasons.get(id) || null,
            // Bought below ratio 1.0 for the bonus tiers of the shop its coins go to.
            forTiers: b.ratio < 0.995 && valuation.plan.forBonusTiers(pkg),
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

/**
 * The Details block: the package's contents in the table's columns. On phones (Rank, Type, Category and
 * Worth hidden) the worth of all of them moves under "Buy".
 */
function detailsHtml(entry) {
    const header = gridRow([
        gridHeader('', { wide: true }),
        gridHeader(t('rankings.table.item')),
        gridHeader('', { wide: true }),
        gridHeader(t('rankings.table.category'), { wide: true }),
        gridHeader(t('rankings.table.worthEach'), { num: true }),
        gridHeader('', { wide: true }),
        gridHeader(),
        gridHeader(t('rankings.table.worth'), { num: true }),
        gridHeader(),
        gridHeader(),
    ]);
    const rows = breakdownParts(entry.parts, data, valuation).map((part) =>
        gridRow([
            gridCell('', { wide: true }),
            gridCell(part.item, { className: 'item-cell' }),
            gridCell('', { wide: true }),
            gridCell(part.category, { wide: true }),
            gridNum(part.worthEach),
            gridCell('', { wide: true }),
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
                gridNum(entry.rank && !tieFlags[index] ? entry.rank : '', { wide: true }),
                gridCell(`${entry.name}${requiresIconHtml(entry.requires, data.packages, data.items, locale)}`),
                gridCell(`<span class="pill pill--${entry.type}">${enumLabel('sourceType', entry.type)}</span>`, {
                    wide: true,
                }),
                gridCell(
                    `${enumLabel('category', entry.category)}${entry.availableDays?.length ? infoIconHtml(formatDays(entry.availableDays)) : ''}`,
                    { wide: true },
                ),
                gridNum(entry.priceHtml),
                gridNum(buyHtml(entry), { className: 'skip-cell' }),
                gridCell(skipCellHtml(entry), { className: 'skip-cell' }),
                gridNum(banknotesHtml(formatThousands(entry.worth, 0)), { wide: true }),
                gridNum(ratioHtml(entry, maxRatio)),
                gridCell(detailsToggleHtml(entry.key, expandedKeys)),
            ],
            { buy: entry.planned > 1e-6, dim: Boolean(entry.skipCause) },
        );
        return `${heading}${row}${detailsHtml(entry)}`;
    });

    const header = gridRow([
        gridHeader(t('rankings.table.rank'), { num: true, wide: true }),
        gridHeader(t('rankings.table.name')),
        gridHeader(t('rankings.table.type'), { wide: true }),
        gridHeader(t('rankings.table.category'), { wide: true }),
        gridHeader(t('rankings.table.price'), { num: true }),
        gridHeader(t('rankings.table.buy'), { num: true }),
        gridHeader(),
        gridHeader(t('rankings.table.worth'), { num: true, wide: true }),
        gridHeader(t('rankings.table.ratio'), { num: true }),
        gridHeader(),
    ]);
    rankingTable.innerHTML = gridTable(header, rows.join(''));
    hydrateItemIcons(rankingTable);
    enableInfoTooltips(rankingTable);
    wireDetailsToggles(rankingTable, expandedKeys);
}

/** "All / Plan only" and one pill per purchase type on sale (none ticked = every type). */
function renderFilters() {
    const chip = (attrs, label, pressed) =>
        `<button type="button" class="toggle-chip" ${attrs} aria-pressed="${pressed}">${label}</button>`;
    showMode.innerHTML =
        chip('data-show="all"', t('rankings.showAll'), !planOnly) +
        chip('data-show="plan"', t('rankings.showPlan'), planOnly);
    const types = [...new Set(entries.map((entry) => entry.type))];
    for (const type of [...shownTypes]) {
        if (!types.includes(type)) {
            shownTypes.delete(type);
        }
    }
    typeFilter.innerHTML = types
        .map((type) => chip(`data-type="${type}"`, enumLabel('sourceType', type), shownTypes.has(type)))
        .join('');
}

function applyFilters() {
    const search = searchInput.value.trim().toLowerCase();
    renderTable(
        entries.filter(
            (entry) =>
                (!planOnly || entry.planned > 1e-6) &&
                (shownTypes.size === 0 || shownTypes.has(entry.type)) &&
                (!search || `${entry.name} ${enumLabel('category', entry.category)}`.toLowerCase().includes(search)),
        ),
    );
}

function rebuild() {
    entries = buildEntries();
    const plan = valuation.plan;
    rankingMeta.textContent = t('rankings.planShort', {
        purchases: formatThousands(plan.purchases.length),
        spent: formatThousands(plan.spent, 0),
        budget: formatThousands(plan.budget, 0),
        count: formatThousands(entries.filter((entry) => entry.rank).length),
    });
    panel.showRate(valuation);
    renderFilters();
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
        panel = mountValuationPanel(document.getElementById('valuation-panel'), data);
        onSettingsChange((next) => {
            settings = next;
            recompute();
        });
        // Skip / Undo: saved with the settings, which makes every page plan again (a skip lasts until the week or the
        // pack's event / pass is over).
        rankingTable.addEventListener('click', (event) => {
            const button = event.target.closest('button[data-skip], button[data-unskip]');
            if (!button) {
                return;
            }
            const skipped = { ...settings.skippedPackages };
            if (button.dataset.skip) {
                const id = button.dataset.skip;
                skipped[id] = skipUntilDay(id, data.packages[id], gameDay(new Date()).day, data);
            } else {
                delete skipped[button.dataset.unskip];
            }
            updateSettings({ skippedPackages: skipped });
        });
        searchInput.addEventListener('input', applyFilters);
        showMode.addEventListener('click', (event) => {
            const button = event.target.closest('[data-show]');
            if (button) {
                planOnly = button.dataset.show === 'plan';
                renderFilters();
                applyFilters();
            }
        });
        typeFilter.addEventListener('click', (event) => {
            const button = event.target.closest('[data-type]');
            if (button) {
                const { type } = button.dataset;
                if (shownTypes.has(type)) {
                    shownTypes.delete(type);
                } else {
                    shownTypes.add(type);
                }
                renderFilters();
                applyFilters();
            }
        });
        await recompute();
    },
    onLocaleChange: rebuild,
});
