/**
 * The progress (steps done, awakening levels, per faction): its storage and the actions that change it.
 */
import { STORAGE_KEYS, readJson, writeJson } from '../../ui/storage.js';
import { skillSteps } from '../../core/skill-path.js';
import { ctx } from './state.js';
import { render } from './index.js';

// The highest awakening level (the last of `awakening_caps`).
const maxAwakening = () => ctx.skills.awakening_caps.at(-1).level;

/** The saved progress: `{ faction, warrior: { done, awakening: { marlena: 3 } }, ranger: …, warlock: … }`. */
function savedProgress() {
    return readJson(STORAGE_KEYS.skillProgress);
}

/** The steps of the faction shown and its saved progress (none saved yet: nothing done). */
function loadProgress() {
    ctx.steps = skillSteps(ctx.skills, ctx.data.heroes, ctx.shownFaction);
    const saved = savedProgress()[ctx.shownFaction] || {};
    ctx.done = Number.isInteger(saved.done) ? Math.min(Math.max(saved.done, 0), ctx.steps.length) : 0;
    ctx.awakening = {};
    for (const [hero, level] of Object.entries(saved.awakening || {})) {
        if (ctx.skills.heroes[hero]?.awakenable && Number.isInteger(level)) {
            ctx.awakening[hero] = Math.min(Math.max(level, 0), maxAwakening());
        }
    }
    ctx.selected = null;
}

function saveProgress() {
    writeJson(STORAGE_KEYS.skillProgress, {
        ...savedProgress(),
        faction: ctx.shownFaction,
        [ctx.shownFaction]: { done: ctx.done, awakening: ctx.awakening },
    });
}

function commit() {
    saveProgress();
    render();
}

/** Done (+1) or Undo (-1). */
function advance(direction) {
    ctx.done = Math.min(Math.max(ctx.done + direction, 0), ctx.steps.length);
    commit();
}

/** A click on a step in the full list (`position`, from 1): it and the steps before it done, the later ones not. */
function jumpTo(position) {
    ctx.done = Math.min(Math.max(position, 0), ctx.steps.length);
    commit();
}

/** Start over: the faction shown only (the awakening levels stay). */
function startOver() {
    ctx.done = 0;
    commit();
}

/** A hero's awakening level (0 to the highest). */
function setAwakening(hero, level) {
    ctx.awakening[hero] = Math.min(Math.max(Number.isFinite(level) ? Math.trunc(level) : 0, 0), maxAwakening());
    commit();
}

/** Another faction: its heroes and its own progress. */
function setFaction(faction) {
    ctx.shownFaction = faction;
    loadProgress();
    saveProgress();
    render();
}

export { advance, jumpTo, loadProgress, maxAwakening, savedProgress, setAwakening, setFaction, startOver };
