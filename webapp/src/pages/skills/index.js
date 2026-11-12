/**
 * Skill Upgrade Path: in which order to level up the skills of a squad's heroes (`data/hero_skills.json`), one step at a time. The board
 * shows the five heroes of a faction as the squad stands, with their skills as in the game; the guide next to it has
 * the next step (the foundation first, then each hero's priorities, heroes in the guide's order) and the full list.
 * Click a skill for what it does at the hero's level (shown below the heroes). The three hero factions have their own heroes, order and progress, saved in this
 * browser; awakened heroes (Marlena, Cynthia, Annie) have an awakening level that shows their skill cap. On narrow
 * screens the guide comes before the board. The steps and levels live in core/skill-path.js.
 */
import { startPage } from '../../ui/page.js';
import '../../styles/pages/skills.css';
import { FACTIONS } from '../../ui/hero-parts.js';
import { ctx } from './state.js';
import { renderBoard, renderFactions } from './board.js';
import { layout } from './elements.js';
import { renderGuide } from './guide.js';
import { renderHelp } from './help.js';
import { loadProgress, savedProgress } from './progress.js';

function render() {
    renderFactions();
    renderHelp();
    renderBoard();
    renderGuide();
}

async function init(loaded) {
    ctx.data = loaded;
    // The factions the guide has heroes for.
    ctx.factions = FACTIONS.filter((faction) => {
        const order = ctx.skills.order[faction] || [];
        return order.length > 0 && order.every((hero) => ctx.data.heroes?.[hero]);
    });
    if (ctx.factions.length === 0) {
        document.getElementById('skills-empty').hidden = false;
        return;
    }
    // The faction shown last (the first one the first time).
    const { faction: lastFaction } = savedProgress();
    ctx.shownFaction = ctx.factions.includes(lastFaction) ? lastFaction : ctx.factions[0];
    loadProgress();
    layout.hidden = false;
    render();
}

startPage('skills', { init, onLocaleChange: () => render() });

export { render };
