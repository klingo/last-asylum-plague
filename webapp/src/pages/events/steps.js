/**
 * The step table: how much spending more on the event still pays off.
 */
import { planOptions } from '../../ui/valuation.js';
import { solveWeeklyPlan } from '../../core/planner.js';
import { getSettings } from '../../ui/settings.js';
import { cheapestEventPackPrice } from '../../core/catalog.js';
import { analyseEventSteps } from '../../core/step-analysis.js';
import { packageDisplayName } from '../../ui/labels.js';
import { banknotesAmount } from '../../ui/html.js';
import { gridRow, gridTable } from '../../ui/grid.js';
import { t, tHtml, getLocale } from '../../ui/i18n.js';
import { formatThousands } from '../../ui/format.js';
import { ratioCellHtml, ratioScale } from '../../ui/ratio-bar.js';
import { ctx } from './state.js';
import { WIDE, cell, headerCell, numCell } from './cells.js';
import { extraFor, maxSpendOf, overridesKey, pageOverrides } from './context.js';
import { stepsCard, stepsNote, stepsTable } from './elements.js';

/** How much spending on the event is worth it (step-analysis.js `analyseEventSteps`). */
function stepAnalysis(eventId) {
    return analyseEventSteps({
        eventId,
        base: ctx.valuation.plan,
        rate: ctx.valuation.rate,
        maxSpend: maxSpendOf(eventId),
        cheapestPrice: cheapestEventPackPrice(ctx.data.packages, eventId),
        budget: getSettings().budget,
        extraBanknotes: extraFor(eventId),
        solve: (overrides) =>
            solveWeeklyPlan(
                ctx.valuation.highs,
                ctx.data,
                planOptions(ctx.data, getSettings(), { ...pageOverrides(), ...overrides }),
            ),
    });
}

function renderSteps({ eventId }) {
    // Only events with packages on sale have something to spend Banknotes on.
    stepsCard.hidden = !eventId || !(maxSpendOf(eventId) > 0);
    if (stepsCard.hidden) {
        return;
    }
    const cacheKey = `${eventId}|${overridesKey()}|${JSON.stringify(getSettings())}`;
    if (ctx.stepCache.key !== cacheKey) {
        ctx.stepCache = { key: cacheKey, steps: stepAnalysis(eventId) };
    }
    const steps = ctx.stepCache.steps;
    const locale = getLocale();
    const maxRatio = ratioScale(steps.map((step) => step.ratio));
    const packsHtml = (packs) =>
        packs.length > 0
            ? `<ul class="cell-list">${packs.map((p) => `<li>${packageDisplayName(p.pkg, locale)} ×${formatThousands(p.count)}</li>`).join('')}</ul>`
            : t('common.dash');
    const rows = steps.map((step) =>
        gridRow(
            [
                numCell(
                    `${step.isPlan ? `<span class="text-dim">${tHtml('events.yourPlan')}</span>&nbsp;` : ''}${banknotesAmount(step.eventSpend)}`,
                ),
                numCell(step.stepCost === null ? t('common.dash') : banknotesAmount(step.stepCost)),
                numCell(step.stepWorth === null ? t('common.dash') : banknotesAmount(step.stepWorth), WIDE),
                numCell(ratioCellHtml(step.ratio, maxRatio)),
                cell(packsHtml(step.packs)),
            ],
            { buy: step.isPlan },
        ),
    );
    const header = gridRow([
        headerCell('events.table.eventSpend', true),
        headerCell('events.table.stepCost', true),
        headerCell('events.table.stepWorth', true, true),
        headerCell('events.table.stepRatio', true),
        headerCell('events.table.packs'),
    ]);
    stepsTable.innerHTML = gridTable(header, rows.join(''));
    stepsNote.textContent = t('events.stepsNote');
}

export { renderSteps };
