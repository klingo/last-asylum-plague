import './style.css';
import { renderNav } from './nav';
import { loadPackData } from './lib/data';
import { buildValuation, modelSummaryText } from './lib/valuation';
import { mountValuationPanel } from './lib/valuation-panel';
import { withLoading } from './lib/loading';
import { solveNeeds } from './lib/acquire.js';
import { isSeasonalOff } from './lib/catalog.js';
import {
    packageDisplayName,
    itemDisplayName,
    offerDisplayName,
    todayWeekdayIndex,
    conversionLabel,
} from './lib/labels';
import { createItemPicker } from './lib/item-picker';
import { banknoteIconHtml } from './lib/images';
import { formatThousands, formatSignificant } from './lib/format';
import { t, getLocale, applyStaticTranslations } from './lib/i18n';

renderNav('compare');
applyStaticTranslations();

const sides = ['a', 'b'].map((key) => ({
    key,
    picker: createItemPicker({
        input: document.getElementById(`${key}-search`),
        panel: document.getElementById(`${key}-listbox`),
        clearButton: document.getElementById(`${key}-search-clear`),
        onChange: () => recompute(),
    }),
    amount: document.getElementById(`${key}-amount`),
}));
const daysInput = document.getElementById('days-input');
const resultCard = document.getElementById('result-card');
const compareBar = document.getElementById('compare-bar');
const verdict = document.getElementById('verdict');
const compareTable = document.getElementById('compare-table');
const compareNote = document.getElementById('compare-note');

let data = null;
let settings = null;
let valuation = null;
let runId = 0;

const gold = (value, digits = 0) =>
    Number.isFinite(value)
        ? `<span class="text-gold">${formatThousands(value, digits)}</span> ${banknoteIconHtml()}`
        : t('common.notAvailable');

/** Package ids of the seasonal passes that aren't on sale right now. */
function unavailablePassIds() {
    return new Set(
        Object.entries(data.packages)
            .filter(([id, pkg]) => isSeasonalOff(id, pkg, settings.seasonalPass))
            .map(([id]) => id),
    );
}

/** Worth of the side and the cheapest guaranteed way to get it within the chosen days. */
function evaluate(side) {
    const itemId = side.picker.getValue();
    const amount = Math.floor(Number(side.amount.value));
    if (!itemId || !(amount > 0)) {
        return null;
    }
    const unitWorth = valuation.worth(itemId);
    const plan = solveNeeds(valuation.highs, data, new Map([[itemId, amount]]), {
        days: Math.max(1, Math.floor(Number(daysInput.value) || 7)),
        startDay: todayWeekdayIndex(),
        activeEventIds: new Set(settings.activeEvents),
        includeExclusives: false,
        excluded: unavailablePassIds(),
        worthOf: (id) => valuation.worth(id) ?? 0,
    });
    return { itemId, amount, worth: Number.isFinite(unitWorth) ? unitWorth * amount : NaN, plan };
}

function stepsHtml(plan, locale) {
    if (!plan.reachable) {
        return `<span class="text-dim">${t('compare.unreachable')}</span>`;
    }
    const lines = [
        ...plan.packages.map((p) => `${formatThousands(p.count)} × ${packageDisplayName(p.pkg, locale)}`),
        ...plan.offers.map(
            (o) => `${formatThousands(o.count)} × ${offerDisplayName(o.shop, o.offer, data.items, locale)}`,
        ),
        ...plan.conversions
            .filter((c) => c.kind !== 'open' || c.random)
            .map((c) => `${formatSignificant(c.count)} × ${conversionLabel(c, data.items, locale)}`),
    ];
    return lines.length ? `<ul class="parts-list">${lines.map((line) => `<li>${line}</li>`).join('')}</ul>` : '';
}

/** Split bar of the two sides' worth: each side's share of the total, with the amounts below. */
function valueBarHtml(a, b, name) {
    if (!(a?.worth > 0) || !(b?.worth > 0)) {
        return '';
    }
    const total = a.worth + b.worth;
    const [pctA, pctB] = [a.worth / total, b.worth / total].map((share) => (share * 100).toFixed(1));
    return `
        <div class="compare-bar__track">
            <div class="compare-bar__segment compare-bar__segment--a" style="width: ${pctA}%"></div>
            <div class="compare-bar__segment compare-bar__segment--b" style="width: ${pctB}%"></div>
        </div>
        <div class="compare-bar__labels">
            <div class="compare-bar__label">
                <span class="compare-bar__swatch compare-bar__swatch--a"></span>${name(a)}: ${gold(a.worth)} (${pctA}%)
            </div>
            <div class="compare-bar__label">
                ${name(b)}: ${gold(b.worth)} (${pctB}%)<span class="compare-bar__swatch compare-bar__swatch--b"></span>
            </div>
        </div>`;
}

function render(results) {
    const locale = getLocale();
    const [a, b] = results;
    resultCard.hidden = !a && !b;
    if (!a && !b) {
        return;
    }
    const name = (r) => (r ? `${formatThousands(r.amount)} × ${itemDisplayName(data.items, r.itemId, locale)}` : '—');
    const net = (r) => (r?.plan.reachable ? r.plan.totalCost - r.plan.byproductWorth : NaN);
    compareBar.innerHTML = valueBarHtml(a, b, name);

    // Mirrored table: first item left, labels in the middle, second item right. The better side of a
    // row (more worth / extras, less cost) is highlighted.
    const row = (label, value, format, better) => {
        const [va, vb] = [a, b].map((r) => (r ? value(r) : NaN));
        const best = Number.isFinite(va) && Number.isFinite(vb) && va !== vb ? (better(va, vb) ? 'a' : 'b') : null;
        const cell = (r, v, side) =>
            `<td class="compare-table__${side} ${best === side ? 'compare-table__best' : ''}">${r ? format(r, v) : ''}</td>`;
        return `<tr>${cell(a, va, 'a')}<th class="compare-table__label">${label}</th>${cell(b, vb, 'b')}</tr>`;
    };
    const reachableGold = (r, v) =>
        r.plan.reachable ? gold(v) : `<span class="text-dim">${t('compare.unreachable')}</span>`;
    compareTable.innerHTML = `
        <thead><tr>
            <th class="compare-table__a"><span class="compare-bar__swatch compare-bar__swatch--a"></span> ${name(a)}</th>
            <th class="compare-table__label"></th>
            <th class="compare-table__b"><span class="compare-bar__swatch compare-bar__swatch--b"></span> ${name(b)}</th>
        </tr></thead>
        <tbody>
            ${row(
                t('compare.worth'),
                (r) => r.worth,
                (r, v) => gold(v),
                (x, y) => x > y,
            )}
            ${row(
                t('compare.cost'),
                (r) => (r.plan.reachable ? r.plan.totalCost : NaN),
                reachableGold,
                (x, y) => x < y,
            )}
            ${row(
                t('compare.extras'),
                (r) => (r.plan.reachable ? r.plan.byproductWorth : NaN),
                reachableGold,
                (x, y) => x > y,
            )}
            ${row(t('compare.net'), net, reachableGold, (x, y) => x < y)}
            <tr>
                <td class="compare-table__a">${a ? stepsHtml(a.plan, locale) : ''}</td>
                <th class="compare-table__label">${t('compare.how')}</th>
                <td class="compare-table__b">${b ? stepsHtml(b.plan, locale) : ''}</td>
            </tr>
        </tbody>`;
    const parts = [];
    if (a && b && a.worth > 0 && b.worth > 0) {
        const [more, less] = a.worth >= b.worth ? [a, b] : [b, a];
        parts.push(
            t('compare.verdictWorth', {
                more: name(more),
                less: name(less),
                factor: formatThousands(more.worth / less.worth, 2),
            }),
        );
    }
    if (a?.plan.reachable && b?.plan.reachable) {
        const [cheaper, dearer] = net(a) <= net(b) ? [a, b] : [b, a];
        parts.push(t('compare.verdictCost', { cheaper: name(cheaper), dearer: name(dearer) }));
    }
    verdict.innerHTML = parts.join(' ');
    compareNote.textContent = `${t('compare.note')} ${modelSummaryText(valuation)}`;
}

async function recompute() {
    if (!data || !valuation) {
        return;
    }
    const run = ++runId;
    await withLoading(() => {
        if (run === runId) {
            render(sides.map(evaluate));
        }
    });
}

async function revalue() {
    await withLoading(async () => {
        valuation = await buildValuation(data, settings);
    });
    await recompute();
}

async function init() {
    data = await loadPackData();
    const panel = mountValuationPanel(document.getElementById('valuation-panel'), data, {
        fields: ['budget', 'events', 'passes'],
        onChange: (next) => {
            settings = next;
            revalue();
        },
    });
    settings = panel.getSettings();
    for (const side of sides) {
        side.picker.setItems(data.items);
        side.amount.addEventListener('change', () => recompute());
    }
    daysInput.addEventListener('change', () => recompute());
    window.addEventListener('localechange', () => {
        applyStaticTranslations();
        for (const side of sides) {
            side.picker.setItems(data.items);
        }
        recompute();
    });
    await revalue();
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
