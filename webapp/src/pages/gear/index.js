/**
 * Gear Upgrade Path: a squad's formation (front row of tanks, back row of carries and the support) with each hero's
 * gear in a 2×2 square, and the guide to its UR gear (`squad_guides` in pack_data.json) in two phases:
 * 1. Crafting: every hero gets all their UR pieces first, step by step.
 * 2. Upgrades, unlocked after crafting: two queues, one card each (the next level step and the next star step). Which
 *    one to take depends on what you have (star steps use Gear Blueprints). Levels and stars wait for each other
 *    (core/gear-path.js works out what a step needs); a blocked step says what it needs first.
 * The hero factions (Warriors, Rangers, Warlocks) share the paths; each slot has a hero per faction. The progress
 * (steps done per queue) is saved in this browser, per faction.
 */
import { startPage } from '../../ui/page.js';
import '../../styles/pages/gear.css';
import { createProgress } from '../../core/gear-progress.js';
import { ctx } from './state.js';
import { renderFactions } from './board.js';
import { FACTIONS } from './constants.js';
import { layout } from './elements.js';
import { renderProgress } from './guide.js';
import { renderHelp } from './help.js';
import { loadProgress, savedProgress } from './progress.js';

function render() {
    renderFactions();
    renderHelp();
    renderProgress();
}

async function init(loaded) {
    ctx.data = loaded;
    [ctx.guideId] = Object.keys(ctx.data.squad_guides || {});
    ctx.guide = ctx.guideId ? ctx.data.squad_guides[ctx.guideId] : null;
    ctx.gearSet = ctx.guide ? ctx.data.gear_upgrades?.[ctx.guide.gear] : null;
    ctx.factions = ctx.guide
        ? FACTIONS.filter((faction) =>
              Object.values(ctx.guide.slots).every((slot) => ctx.data.heroes?.[slot.heroes?.[faction]]),
          )
        : [];
    if (!ctx.guide || !ctx.gearSet || ctx.factions.length === 0) {
        document.getElementById('gear-empty').hidden = false;
        return;
    }
    ctx.progress = createProgress(ctx.guide, ctx.gearSet);
    // The faction shown last (the first one the first time).
    const { faction: lastFaction } = savedProgress();
    ctx.shownFaction = ctx.factions.includes(lastFaction) ? lastFaction : ctx.factions[0];
    loadProgress();
    layout.hidden = false;
    render();
}

startPage('gear', { init, onLocaleChange: () => render() });

export { render };
