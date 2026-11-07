/**
 * Dig events: the verdict card, the pickaxe tile, the floor table with its Details and the mine's rules.
 */
import { getSettings } from '../../ui/settings.js';
import { MINE_SAFETY_LEVELS } from '../../core/settings-model.js';
import { currencyCost } from '../../core/catalog.js';
import { eventPurchases } from '../../core/step-analysis.js';
import { packageDisplayName, itemDisplayName, itemLinkName, bundleLabel } from '../../ui/labels.js';
import {
    banknotesAmount,
    buyBadge,
    escapeAttr,
    escapeHtml,
    hydrateItemIcons,
    statHtml,
    tileHtml,
} from '../../ui/html.js';
import {
    gridHeader,
    gridRow,
    gridTable,
    gridSection,
    gridDetails,
    detailsToggleHtml,
    wireDetailsToggles,
    breakdownParts,
} from '../../ui/grid.js';
import { enableInfoTooltips } from '../../ui/tooltip.js';
import { t, tHtml, getLocale, localizedName } from '../../ui/i18n.js';
import { formatThousands } from '../../ui/format.js';
import { ratioCellHtml, ratioScale } from '../../ui/ratio-bar.js';
import {
    targetFloor,
    floorsFor,
    normalRewardBundle,
    mineEconomics as computeMineEconomics,
    pityGroups,
} from '../../core/mine.js';
import { ctx } from './state.js';
import { WIDE, cell, headerCell, iconHtml, numCell } from './cells.js';
import { extraFor, minePlan, mineRun, pageOverrides } from './context.js';
import { mineHeading, mineRules, mineSection, mineTable } from './elements.js';

// The mine table's open Details blocks (kept across re-renders).
const mineExpanded = new Set();

/** Percent of the way through the mine's floors (the floor track, 0 = before floor 1). */
const floorPercent = (mine, floor) =>
    `${((100 * Math.min(Math.max(floor, 0), mine.floors)) / mine.floors).toFixed(2)}%`;

/** What the mine's floors cost and give from the floor reached (mine.js `mineEconomics`). */
function mineEconomics(dug) {
    const { mine } = dug;
    return computeMineEconomics(dug, {
        pickaxeWorth: ctx.valuation.worth(mine.currency_item_id),
        bundleWorth: (contents) => ctx.valuation.bundle({ contains: contents }, 0).worth,
        coin: ctx.valuation.plan.currencies.get(mine.currency_item_id),
        packCost: (bought) =>
            currencyCost(ctx.data.packages, mine.currency_item_id, bought, {
                activeEventIds: new Set(getSettings().activeEvents),
                seasonalPasses: getSettings().seasonalPasses,
                eventDaysLeft: pageOverrides().eventDaysLeft,
            }),
    });
}

/**
 * How sure to be about the pickaxes for the target floor (the digs are random): the average, 9 in 10, 99 in 100
 * or every run (the worst case: every floor only at its pity), each with its pickaxes. The choice is what the
 * plan counts with (`minePlanSafety` in the settings; the change is wired in init).
 */
function mineSafetyHtml(dug, econ) {
    const icon = iconHtml(dug.mine.currency_item_id);
    const keys = { 0.5: 'average', 0.9: 'p90', 0.99: 'p99', 1: 'max' };
    const options = MINE_SAFETY_LEVELS.map((level) => {
        let pickaxes = econ.odds.atLeast(level);
        if (level === 0.5) {
            pickaxes = econ.odds.mean;
        } else if (level >= 1) {
            pickaxes = econ.odds.max;
        }
        const on = getSettings().minePlanSafety === level;
        return `<label class="mine-safety__option${on ? ' mine-safety__option--on' : ''}">
            <input type="radio" name="mine-safety" value="${level}" ${on ? 'checked' : ''} />
            <span class="mine-safety__amount">${icon}${level === 0.5 ? '≈' : ''}${formatThousands(pickaxes, 0)}</span>
            <span class="mine-safety__label">${tHtml(`events.mineSafety.${keys[level]}`)}</span>
        </label>`;
    });
    return `<fieldset class="mine-safety">
        <legend>${escapeHtml(
            t('events.mineSafety.title', {
                target: formatThousands(dug.target),
                from: formatThousands(dug.startFloor + 1),
            }),
        )}</legend>
        <div class="mine-safety__options">${options.join('')}</div>
    </fieldset>`;
}

/**
 * The chance the pickaxes this run are enough for the target floor (the luck of the digs, see pickaxeOdds): green
 * from 9 in 10 on, amber from 1 in 2, else red.
 */
function chanceStat(econ) {
    const chance = econ.odds.chanceEnough(econ.have);
    const tone = chance >= 0.9 ? 'text-good' : chance >= 0.5 ? 'text-warn' : 'text-bad';
    let shown = formatThousands(100 * chance, 0);
    if (chance > 0.995 && chance < 1) {
        shown = '> 99';
    } else if (chance < 0.005 && chance > 0) {
        shown = '< 1';
    }
    return statHtml(t('events.mineStat.chance'), `${shown}%`, tone);
}

/**
 * The floor track: floors 0..top as a bar. The floors cleared before (dim), this run's floors (green: the plan
 * digs them) or how far the pickaxes would reach (amber, striped: not dug), a tick per progress reward
 * (green once reached, the reward in the tooltip) and the target floor marked. Below: the scale and a legend.
 */
function floorTrackHtml(dug, reachFloor) {
    const { mine } = dug;
    const locale = getLocale();
    const reached = new Set(dug.progressReached);
    const runEnd = dug.digs ? dug.floorReached : reachFloor;
    const ticks = Object.keys(mine.progress_rewards || {})
        .map(Number)
        .filter((floor) => floor <= mine.floors)
        .sort((a, b) => a - b)
        .map((floor) => {
            const tip = escapeAttr(
                `${tHtml('events.mineTrack.floor', { floor: formatThousands(floor) })}: ${bundleLabel(mine.progress_rewards[String(floor)], ctx.data.items, locale)}`,
            );
            const on = reached.has(floor) || floor <= dug.startFloor;
            return `<span class="floor-track__tick${on ? ' floor-track__tick--on' : ''}${floor === dug.target ? ' floor-track__tick--target' : ''}" style="left: ${floorPercent(mine, floor)}" tabindex="0" data-tooltip="${tip}" aria-label="${tip}"></span>`;
        })
        .join('');
    const legend = [
        dug.startFloor > 0
            ? `<span class="floor-track__key floor-track__key--before">${tHtml('events.mineTrack.before', { floor: formatThousands(dug.startFloor) })}</span>`
            : '',
        runEnd > dug.startFloor
            ? `<span class="floor-track__key floor-track__key--${dug.digs ? 'dig' : 'reach'}">${tHtml(
                  dug.digs ? 'events.mineTrack.dig' : 'events.mineTrack.reach',
                  { from: formatThousands(dug.startFloor + 1), to: formatThousands(runEnd) },
              )}</span>`
            : '',
        `<span class="floor-track__key floor-track__key--tick">${tHtml('events.mineTrack.rewards')}</span>`,
    ].join('');
    return `<div class="floor-track">
        <div class="floor-track__bar">
            <span class="floor-track__before" style="width: ${floorPercent(mine, dug.startFloor)}"></span>
            <span class="floor-track__run floor-track__run--${dug.digs ? 'dig' : 'reach'}" style="left: ${floorPercent(mine, dug.startFloor)}; width: calc(${floorPercent(mine, runEnd)} - ${floorPercent(mine, dug.startFloor)})"></span>
            ${ticks}
        </div>
        <div class="floor-track__scale">
            <span style="left: 0">0</span>
            ${dug.target > 0 ? `<span class="floor-track__scale-target" style="left: ${floorPercent(mine, dug.target)}">${formatThousands(dug.target)}</span>` : ''}
            <span style="left: 100%">${formatThousands(mine.floors)}</span>
        </div>
        <div class="floor-track__legend">${legend}</div>
    </div>`;
}

/**
 * The verdict card on top of the plan: dig this run or not. Unused pickaxes carry over, the floors don't, so
 * the plan only digs a run that reaches the last progress reward (planner.js). Then the floor track and the key
 * numbers: what the run digs, or why not (the pickaxes missing and what they'd cost and give; more than the
 * weekly spend; or more than the packs can give in the days left).
 */
function mineVerdictTile(dug) {
    const { mine } = dug;
    const econ = mineEconomics(dug);
    const amount = (value) => formatThousands(value, 0);
    const icon = iconHtml(mine.currency_item_id);
    const target = amount(dug.target);
    // Past the target floor nothing is dug any more: no "would reach" bar either.
    const reachFloor =
        dug.startFloor >= dug.target ? dug.startFloor : dug.startFloor + floorsFor(mine, dug.startFloor, econ.have);
    const left = Math.max(0, econ.have - econ.spent);
    let state;
    let verdict;
    let text; // HTML (tHtml)
    let stats;
    if (dug.digs) {
        state = 'dig';
        verdict = t('events.mineDig');
        text = tHtml('events.mineDigText', { target, reached: amount(dug.floorReached) });
        stats = [
            statHtml(
                t('events.mineStat.floors'),
                `${amount(dug.startFloor + 1)} → ${amount(dug.floorReached)}`,
                'text-good',
            ),
            statHtml(t('events.mineStat.pickaxes'), `${icon}≈${amount(dug.pickaxes)}`),
            statHtml(t('events.mineStat.have'), `${icon}${amount(econ.have)}`),
            chanceStat(econ),
            statHtml(t('events.mineStat.left'), `${icon}${amount(left)}`),
        ];
    } else if (dug.startFloor >= dug.target) {
        state = 'save';
        verdict = t('events.mineStop');
        text = tHtml('events.mineStopPast', { target });
        stats = [
            statHtml(t('events.mineStat.reached'), amount(dug.startFloor), 'text-good'),
            statHtml(t('events.mineStat.left'), `${icon}${amount(left)}`),
        ];
    } else {
        state = 'save';
        verdict = t('events.mineSave');
        const spend = getSettings().budget + extraFor(mine.event_id);
        const unreachable = econ.needed > dug.owned + dug.free.total + econ.available;
        if (unreachable) {
            text = tHtml('events.mineSaveUnreachable', { target, available: amount(econ.available) });
        } else if (econ.costToTarget > spend) {
            text = tHtml('events.mineSaveBudget', { target, budget: banknotesAmount(spend) });
        } else {
            text = tHtml('events.mineSaveText', { target });
        }
        stats = [
            statHtml(t('events.mineStat.needed', { target }), `${icon}≈${amount(econ.needed)}`),
            statHtml(t('events.mineStat.have'), `${icon}${amount(econ.have)}`),
            chanceStat(econ),
            statHtml(
                t('events.mineStat.missing'),
                `${icon}≈${amount(Math.max(0, econ.needed - econ.have))}`,
                'text-warn',
            ),
            unreachable
                ? statHtml(t('events.mineStat.available'), `${icon}${amount(econ.available)}`, 'text-bad')
                : statHtml(t('events.mineStat.cost'), banknotesAmount(econ.costToTarget)),
            statHtml(t('events.mineStat.worth', { target }), banknotesAmount(econ.worthToTarget)),
        ];
    }
    return `<div class="plan-tile plan-tile--wide mine-verdict mine-verdict--${state}">
        <div class="mine-verdict__head">
            <span class="mine-verdict__badge" aria-hidden="true">${state === 'dig' ? icon : '✋'}</span>
            <div>
                <div class="mine-verdict__title">${escapeHtml(verdict)}</div>
                <div class="mine-verdict__text">${text}</div>
            </div>
        </div>
        ${floorTrackHtml(dug, reachFloor)}
        <div class="mine-stats">${stats.join('')}</div>
        ${econ.odds ? mineSafetyHtml(dug, econ) : ''}
    </div>`;
}

/**
 * The pickaxe tile: this run's pickaxes as a bar by source (owned, free, purchase bonus, the event's packs) with
 * a mark at what the target floor needs, a legend with the amounts (each pack on its own line), and what's spent
 * digging and left for the next run.
 */
function pickaxeTile(dug, eventId) {
    const locale = getLocale();
    const { mine, free, owned } = dug;
    const econ = mineEconomics(dug);
    const run = mineRun(mine.event_id);
    const days = formatThousands(free.days);
    const packs = eventPurchases(ctx.valuation.plan, eventId)
        .filter((p) => p.pkg.contains?.[mine.currency_item_id] > 0)
        .map(
            (p) =>
                `<li><span>${packageDisplayName(p.pkg, locale)} ×${formatThousands(p.count)}</span><span>${formatThousands(p.count * p.pkg.contains[mine.currency_item_id], 0)}</span></li>`,
        );
    const sources = [
        { key: 'owned', label: t('events.mineOwned'), qty: owned },
        {
            key: 'free',
            label: t(run?.state === 'next' ? 'events.mineFreeNext' : 'events.mineFreeLeft', {
                perDay: formatThousands(free.perDay),
                days,
            }),
            qty: free.perDay * free.days,
        },
        {
            key: 'bonus',
            label: t('events.mineBonus', { perDay: formatThousands(free.bonusPerDay), days }),
            qty: free.bonusPerDay * free.days,
        },
        { key: 'packs', label: t('events.minePacks'), qty: econ.fromPacks },
    ].filter((source) => source.qty > 0.5);
    const total = sources.reduce((sum, source) => sum + source.qty, 0);
    const needed = dug.startFloor < dug.target ? econ.needed : 0;
    const scale = Math.max(total, needed, 1);
    const percent = (qty) => `${((100 * qty) / scale).toFixed(2)}%`;
    const bar = `<div class="pick-bar">${sources
        .map(
            (source) =>
                `<span class="pick-bar__part pick-bar__part--${source.key}" style="width: ${percent(source.qty)}"></span>`,
        )
        .join('')}${
        needed > 0
            ? `<span class="pick-bar__mark${total >= needed ? ' pick-bar__mark--met' : ''}" style="left: ${percent(needed)}"></span>`
            : ''
    }</div>`;
    const markLabel =
        needed > 0
            ? `<div class="pick-bar__caption">${tHtml('events.mineNeedMark', {
                  target: formatThousands(dug.target),
                  count: formatThousands(needed, 0),
              })}</div>`
            : '';
    const legend = `<ul class="pick-legend">${sources
        .map(
            (source) =>
                `<li><span class="pick-legend__dot pick-legend__dot--${source.key}"></span><span>${escapeHtml(source.label)}</span><strong>${formatThousands(source.qty, 0)}</strong></li>${
                    source.key === 'packs' && packs.length > 0
                        ? `<li class="pick-legend__packs"><ul class="plan-list">${packs.join('')}</ul></li>`
                        : ''
                }`,
        )
        .join('')}</ul>`;
    const noBonus =
        mine.purchase_bonus_per_day > 0 && free.bonusPerDay === 0
            ? `<div class="plan-tile__note text-dim">${tHtml('events.mineNoBonus', {
                  perDay: formatThousands(mine.purchase_bonus_per_day),
                  price: formatThousands(
                      Math.min(
                          ...Object.values(ctx.data.packages)
                              .filter((pkg) => pkg.event_id === mine.event_id && pkg.price > 0)
                              .map((pkg) => pkg.price),
                      ),
                  ),
              })}</div>`
            : '';
    return tileHtml(
        itemDisplayName(ctx.data.items, mine.currency_item_id, locale),
        `<div class="pick-total">${iconHtml(mine.currency_item_id)}${tHtml('events.mineTotal', {
            count: `<strong>${formatThousands(total, 0)}</strong>`,
        })}</div>
        ${bar}${markLabel}${legend}${noBonus}
        <div class="plan-tile__total pick-foot">
            <span>${tHtml('events.spentDigging')} <strong>${formatThousands(econ.spent, 0)}</strong></span>
            <span>${tHtml('events.mineStat.left')} <strong>${formatThousands(Math.max(0, total - econ.spent), 0)}</strong></span>
        </div>`,
    );
}

/**
 * The mine table: one row per stretch of floors from the floor reached (mineEconomics), each with a Details
 * block (mineDetailsHtml), then the wish rewards with the plan's pick.
 */
function renderMine({ mineId, mine }) {
    const dug = mine ? minePlan(mineId) : null;
    mineSection.hidden = !dug;
    if (!dug) {
        return;
    }
    const locale = getLocale();
    const pickaxeIcon = iconHtml(mine.currency_item_id);
    mineHeading.textContent = localizedName(mine.name, locale);
    const econ = mineEconomics(dug);
    const { rows, wishWorths } = econ;
    const maxRatio = ratioScale(rows.map((row) => row.ratio));
    const floorRows = rows.map((row) => {
        const { segment, worth, cost, ratio } = row;
        const label = t('events.mineFloors', {
            from: formatThousands(segment.from),
            to: formatThousands(segment.to),
        });
        let reward = '';
        if (segment.reward) {
            reward = ` <span class="text-dim">+ ${bundleLabel(segment.reward, ctx.data.items, locale)}</span>`;
        } else if (segment.aboveTarget) {
            reward = ` <span class="text-dim">${tHtml('events.mineAboveTarget')}</span>`;
        }
        const key = `mine:${mineId}:${segment.from}`;
        return (
            gridRow(
                [
                    cell(`${pickaxeIcon}${escapeHtml(label)}${reward}`, 'item-cell'),
                    numCell(`≈${formatThousands(segment.pickaxes, 0)} ${pickaxeIcon}`),
                    numCell(cost > 0 ? banknotesAmount(cost) : t('common.dash'), WIDE),
                    numCell(banknotesAmount(worth)),
                    numCell(ratioCellHtml(ratio, maxRatio)),
                    numCell(detailsToggleHtml(key, mineExpanded)),
                ],
                { buy: segment.cleared > 0 },
            ) + mineDetailsHtml(key, dug, row, econ)
        );
    });

    const wishRows = mine.wish_rewards.map((reward, index) => {
        const count = dug.wishes[index]?.count || 0;
        const firstItem = Object.keys(reward)[0];
        return gridRow(
            [
                cell(`${iconHtml(firstItem)}${bundleLabel(reward, ctx.data.items, locale)}`, 'item-cell'),
                numCell(t('common.dash')),
                numCell(t('common.dash'), WIDE),
                numCell(banknotesAmount(wishWorths[index])),
                numCell(''),
                numCell(count > 0 ? buyBadge(`×${formatThousands(count)}`) : ''),
            ],
            { buy: count > 0 },
        );
    });

    const header = gridRow([
        headerCell('events.table.floors'),
        headerCell('events.table.pickaxes', true),
        headerCell('events.table.costBanknotes', true, true),
        headerCell('common.table.worth', true),
        headerCell('common.table.ratio', true),
        gridHeader(''),
    ]);
    mineTable.innerHTML = gridTable(
        header,
        `${floorRows.join('')}${gridSection(tHtml('events.wishSection'))}${wishRows.join('')}`,
    );
    hydrateItemIcons(mineTable);
    enableInfoTooltips(mineTable);
    wireDetailsToggles(mineTable, mineExpanded);
    renderMineRules(mine);
}

/**
 * The Details block of a stretch of floors: the progress reward for clearing its last floor, the wish rewards
 * (one per floor; the plan's pick marked with the floors it clears) and the other tiles' rewards expected on
 * the way, each item with its icon and worth.
 */
function mineDetailsHtml(key, dug, { segment }, { wishWorths }) {
    const { mine } = dug;
    const intro = (text) => `<p class="ranking-grid__details-intro">${escapeHtml(text)}</p>`;
    // One row per item: icon, name × amount and its worth; `extra`: the last cell.
    const itemRow = (part, worth, extra = '') =>
        gridRow([
            cell(part.item, 'item-cell'),
            numCell(''),
            numCell('', WIDE),
            numCell(worth),
            numCell(''),
            numCell(extra),
        ]);
    const partsOf = (bundle) =>
        breakdownParts(ctx.valuation.bundle({ contains: bundle }, 0).parts, ctx.data, ctx.valuation);
    const blocks = [];
    if (segment.reward) {
        blocks.push(
            intro(t('events.mineDetails.reward', { floor: formatThousands(segment.to) })) +
                partsOf(segment.reward)
                    .map((part) => itemRow(part, part.worth))
                    .join(''),
        );
    }
    blocks.push(
        intro(t('events.mineDetails.wishes', { count: formatThousands(segment.floors) })) +
            mine.wish_rewards
                .map((reward, index) => {
                    const [part] = partsOf(reward);
                    const picked = (dug.wishes[index]?.count || 0) > 0 && segment.cleared > 0;
                    return part
                        ? itemRow(
                              part,
                              banknotesAmount(wishWorths[index]),
                              picked ? buyBadge(`×${formatThousands(segment.cleared)}`) : '',
                          )
                        : '';
                })
                .join(''),
    );
    blocks.push(
        intro(t('events.mineDetails.loot')) +
            partsOf(normalRewardBundle(mine, segment.normalDigs))
                .map((part) => itemRow(part, part.worth))
                .join(''),
    );
    return gridDetails(key, mineExpanded, blocks.join(''));
}

/** A reward bundle as item chips: icon, name (linked) and amount each. */
function bundleIconsHtml(bundle) {
    const locale = getLocale();
    return Object.entries(bundle)
        .map(
            ([id, qty]) =>
                `<span class="item-chip">${iconHtml(id)}${itemLinkName(ctx.data.items, id, locale)} ×${formatThousands(qty)}</span>`,
        )
        .join(' ');
}

/**
 * The mine's rules from the data: tiles and weights, the pity by the floor's last digit (with the most and the
 * average digs), the normal tiles' and wish rewards, the free pickaxes, and that pickaxes carry over while the
 * floors don't.
 */
function renderMineRules(mine) {
    const normals = mine.tiles_per_floor - 1;
    const weights = Object.entries(mine.special_weights || {})
        .map(([digs, weight]) => [Number(digs), weight])
        .sort((a, b) => a[0] - b[0])
        .map(([digs, weight]) =>
            digs === 0
                ? formatThousands(weight)
                : t('events.mineRules.weightAfter', { weight: formatThousands(weight), digs: formatThousands(digs) }),
        )
        .join(', ');
    // Last digits with the same pity side by side (…1 / …6: 5 digs).
    const cellText = (text) => `<td>${escapeHtml(text)}</td>`;
    const pityRows = pityGroups(mine)
        .map(
            ({ pity, digits, averageDigs }) =>
                `<tr>${cellText(digits.map((digit) => `…${digit}`).join(' / '))}${cellText(formatThousands(pity))}${cellText(
                    formatThousands(pity + 1),
                )}${cellText(`≈ ${averageDigs.toFixed(1)}`)}</tr>`,
        )
        .join('');
    const chips = (bundles) =>
        `<div class="mine-rules__chips">${bundles.map((bundle) => bundleIconsHtml(bundle)).join('')}</div>`;
    // The currency as icon and full name ("Dwarven Pickaxe") wherever the rules mention it.
    const pickaxe = `${iconHtml(mine.currency_item_id)}${itemDisplayName(ctx.data.items, mine.currency_item_id, getLocale())}`;
    const line = (key, vars = {}) => `<li>${tHtml(`events.mineRules.${key}`, { ...vars, pickaxe })}`;
    const header = ['lastDigit', 'pityAfter', 'mostDigs', 'averageDigs']
        .map((key) => `<th>${tHtml(`events.mineRules.${key}`)}</th>`)
        .join('');
    mineRules.innerHTML = `<summary>${tHtml('events.mineRules.title')}</summary>
        <ul class="mine-rules__list">
            ${line('tiles', { tiles: formatThousands(mine.tiles_per_floor), normals: formatThousands(normals) })}</li>
            ${line('weights', { normal: formatThousands(mine.normal_weight), wish: weights })}</li>
            ${line('pity')}
                <table class="mine-rules__pity"><thead><tr>${header}</tr></thead><tbody>${pityRows}</tbody></table>
            </li>
            ${line('normal')}${chips(mine.normal_rewards || [])}</li>
            ${line('wishes')}${chips(mine.wish_rewards || [])}</li>
            ${
                mine.free_currency_per_day > 0
                    ? `${line('free', {
                          perDay: formatThousands(mine.free_currency_per_day),
                          bonus: formatThousands(mine.purchase_bonus_per_day || 0),
                      })}</li>`
                    : ''
            }
            ${line('carry', { floors: formatThousands(mine.floors), target: formatThousands(targetFloor(mine)) })}</li>
        </ul>`;
    hydrateItemIcons(mineRules);
}

export { mineVerdictTile, pickaxeTile, renderMine };
