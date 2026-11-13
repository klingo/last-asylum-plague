/**
 * The progress (steps done, per faction): its storage and the actions that change it.
 */
import { STORAGE_KEYS, readJson, writeJson } from '../../ui/storage.js';
import { skillSteps } from '../../core/skill-path.js';
import { ctx } from './state.js';
import { render } from './index.js';

/** The saved progress: `{ faction, warrior: { done }, ranger: …, warlock: … }`. */
function savedProgress() {
    return readJson(STORAGE_KEYS.skillProgress);
}

/** The steps of the faction shown and its saved progress (none saved yet: nothing done). */
function loadProgress() {
    ctx.steps = skillSteps(ctx.skills, ctx.data.heroes, ctx.shownFaction);
    const saved = savedProgress()[ctx.shownFaction] || {};
    ctx.done = Number.isInteger(saved.done) ? Math.min(Math.max(saved.done, 0), ctx.steps.length) : 0;
    ctx.selected = null;
}

function saveProgress() {
    writeJson(STORAGE_KEYS.skillProgress, {
        ...savedProgress(),
        faction: ctx.shownFaction,
        [ctx.shownFaction]: { done: ctx.done },
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

/** Start over: the faction shown only. */
function startOver() {
    ctx.done = 0;
    commit();
}

/** Another faction: its heroes and its own progress. */
function setFaction(faction) {
    ctx.shownFaction = faction;
    loadProgress();
    saveProgress();
    render();
}

export { advance, jumpTo, loadProgress, savedProgress, setFaction, startOver };
