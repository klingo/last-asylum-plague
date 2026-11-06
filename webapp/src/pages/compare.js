/**
 * Compare Items: two items with amounts (`?a=&an=&b=&bn=&days=`): the worth of each, and the cheapest guaranteed way to
 * get each within N days (`solveNeeds` in core/acquire.js: crafting, choices and shops included; weekly limits reset
 * on Monday). Unlike the other pages it does not use the weekly plan for what to buy.
 */
import { startPage } from '../ui/page.js';
import { urlParam, setUrlParams } from '../ui/url.js';
import { mountValuationPage } from '../ui/valuation-page.js';
import { getSettings } from '../ui/settings.js';
import { withLoading } from '../ui/loading.js';
import { solveNeeds } from '../core/acquire.js';
import {
    packageDisplayName,
    itemDisplayName,
    offerDisplayName,
    todayWeekdayIndex,
    conversionLabel,
} from '../ui/labels.js';
import { createItemPicker } from '../ui/item-picker.js';
import { banknotesAmount } from '../ui/html.js';
import { formatThousands, formatSignificant, formatPercent } from '../ui/format.js';
import { t, tHtml, getLocale } from '../ui/i18n.js';

// The two items compared (the pickers are made in init).
const sides = ['a', 'b'].map((key) => ({
    key,
    picker: null,
    amount: document.getElementById(`${key}-amount`),
}));
const daysInput = document.getElementById('days-input');
const resultCard = document.getElementById('result-card');
const compareBar = document.getElementById('compare-bar');
const verdict = document.getElementById('verdict');
const compareTable = document.getElementById('compare-table');
const compareNote = document.getElementById('compare-note');

let data = null;
let valuation = null;
let revalue = null;
let runId = 0;

const worthHtml = (value) => (Number.isFinite(value) ? banknotesAmount(value) : tHtml('common.notAvailable'));

/** Worth of the side and the cheapest guaranteed way to get it within the chosen days. */
function evaluate(side) {
    const itemId = side.picker.getValue();
    const amount = Math.floor(Number(side.amount.value));
    if (!itemId || !(amount > 0)) {
        return null;
    }
    const settings = getSettings();
    const unitWorth = valuation.worth(itemId);
    const plan = solveNeeds(valuation.highs, data, new Map([[itemId, amount]]), {
        days: Math.max(1, Math.floor(Number(daysInput.value) || 7)),
        startDay: todayWeekdayIndex(),
        activeEventIds: new Set(settings.activeEvents),
        includeExclusives: false,
        seasonalPasses: settings.seasonalPasses,
        worthOf: (id) => valuation.worth(id) ?? 0,
    });
    return { itemId, amount, worth: Number.isFinite(unitWorth) ? unitWorth * amount : NaN, plan };
}

function stepsHtml(plan, locale) {
    if (!plan.reachable) {
        return `<span class="text-dim">${tHtml('compare.unreachable')}</span>`;
    }
    const lines = [
        ...plan.packages.map((p) => `${formatThousands(p.count)} × ${packageDisplayName(p.pkg, locale)}`),
        ...plan.offers.map(
            (o) => `${formatThousands(o.count)} × ${offerDisplayName(o.shop, o.offer, data.items, locale)}`,
        ),
        ...plan.conversions
            .filter((c) => c.kind !== 'open')
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
    const [shareA, shareB] = [a.worth / total, b.worth / total];
    const [pctA, pctB] = [shareA, shareB].map((share) => formatPercent(share));
    return `
        <div class="compare-bar__track">
            <div class="compare-bar__segment compare-bar__segment--a" style="width: ${(shareA * 100).toFixed(1)}%"></div>
            <div class="compare-bar__segment compare-bar__segment--b" style="width: ${(shareB * 100).toFixed(1)}%"></div>
        </div>
        <div class="compare-bar__labels">
            <div class="compare-bar__label">
                <span class="compare-bar__swatch compare-bar__swatch--a"></span>${name(a)}: ${worthHtml(a.worth)} (${pctA})
            </div>
            <div class="compare-bar__label">
                ${name(b)}: ${worthHtml(b.worth)} (${pctB})<span class="compare-bar__swatch compare-bar__swatch--b"></span>
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
    const name = (r) =>
        r ? `${formatThousands(r.amount)} × ${itemDisplayName(data.items, r.itemId, locale)}` : t('common.dash');
    const net = (r) => (r?.plan.reachable ? r.plan.totalCost - r.plan.byproductWorth : NaN);
    compareBar.innerHTML = valueBarHtml(a, b, name);

    // Mirrored table: first item left, labels in the middle, second item right. The better side of a
    // row (more worth / extras, less cost) is highlighted.
    const row = (label, value, format, better) => {
        const [va, vb] = [a, b].map((r) => (r ? value(r) : NaN));
        const best = Number.isFinite(va) && Number.isFinite(vb) && va !== vb ? (better(va, vb) ? 'a' : 'b') : null;
        const cell = (r, v, side) =>
            `<td class="compare-table__${side} ${best === side ? 'compare-table__best' : ''}">${r ? format(r, v) : ''}</td>`;
        return `<tr>${cell(a, va, 'a')}<th scope="row" class="compare-table__label">${label}</th>${cell(b, vb, 'b')}</tr>`;
    };
    const reachableGold = (r, v) =>
        r.plan.reachable ? worthHtml(v) : `<span class="text-dim">${tHtml('compare.unreachable')}</span>`;
    compareTable.innerHTML = `
        <thead><tr>
            <th scope="col" class="compare-table__a"><span class="compare-bar__swatch compare-bar__swatch--a"></span> ${name(a)}</th>
            <td class="compare-table__label"></td>
            <th scope="col" class="compare-table__b"><span class="compare-bar__swatch compare-bar__swatch--b"></span> ${name(b)}</th>
        </tr></thead>
        <tbody>
            ${row(
                t('compare.worth'),
                (r) => r.worth,
                (r, v) => worthHtml(v),
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
                <th scope="row" class="compare-table__label">${tHtml('compare.how')}</th>
                <td class="compare-table__b">${b ? stepsHtml(b.plan, locale) : ''}</td>
            </tr>
        </tbody>`;
    const parts = [];
    if (a && b && a.worth > 0 && b.worth > 0) {
        const [more, less] = a.worth >= b.worth ? [a, b] : [b, a];
        parts.push(
            tHtml('compare.verdictWorth', {
                more: name(more),
                less: name(less),
                factor: formatThousands(more.worth / less.worth, 2),
            }),
        );
    }
    if (a?.plan.reachable && b?.plan.reachable) {
        const [cheaper, dearer] = net(a) <= net(b) ? [a, b] : [b, a];
        parts.push(tHtml('compare.verdictCost', { cheaper: name(cheaper), dearer: name(dearer) }));
    }
    verdict.innerHTML = parts.join(' ');
    compareNote.textContent = t('compare.note');
}

/** Both sides and the days in the URL: `?a=<item>&an=<amount>&b=<item>&bn=<amount>&days=<n>`. */
function syncUrl() {
    const [a, b] = sides;
    setUrlParams({
        a: a.picker.getValue(),
        an: a.picker.getValue() ? a.amount.value : null,
        b: b.picker.getValue(),
        bn: b.picker.getValue() ? b.amount.value : null,
        days: daysInput.value !== '7' ? daysInput.value : null,
    });
}

/** The sides and days a link (or a reload) asks for. */
function readUrl() {
    for (const side of sides) {
        const itemId = urlParam(side.key);
        if (itemId && data.items[itemId]) {
            side.picker.setValue(itemId);
            const amount = Number(urlParam(`${side.key}n`));
            if (amount > 0) {
                side.amount.value = String(Math.floor(amount));
            }
        }
    }
    const days = Number(urlParam('days'));
    if (days >= 1) {
        daysInput.value = String(Math.floor(days));
    }
}

async function recompute() {
    if (!data || !valuation) {
        return;
    }
    syncUrl();
    const run = ++runId;
    await withLoading(() => {
        if (run === runId) {
            render(sides.map(evaluate));
        }
    });
}

async function init(loaded) {
    data = loaded;
    ({ recompute: revalue } = mountValuationPage(data, {
        fields: ['budget', 'events', 'passes'],
        render: (next) => {
            valuation = next;
            return recompute();
        },
    }));
    for (const side of sides) {
        side.picker = createItemPicker({
            trigger: document.getElementById(`${side.key}-search`),
            // Either side may be left empty.
            clearable: true,
            onChange: () => recompute(),
        });
        side.picker.setItems(data.items);
        side.amount.addEventListener('change', () => recompute());
    }
    daysInput.addEventListener('change', () => recompute());
    readUrl();
    await revalue();
}

startPage('compare', {
    init,
    onLocaleChange() {
        for (const side of sides) {
            side.picker.setItems(data.items);
        }
        void recompute();
    },
});
