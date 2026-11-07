/**
 * The progress (steps done per queue, per faction): its storage and the actions that change it.
 */
import { readJson, writeJson } from '../../ui/storage.js';
import { ctx } from './state.js';
import { PATHS, STORAGE_KEY } from './constants.js';
import { renderProgress } from './guide.js';
import { render } from './index.js';

/**
 * This guide's saved progress: `{ faction, warrior: { craft, level, stars, mrOnHold }, ranger: …, warlock: … }`
 * (the faction shown last, and per faction its progress). Older saves held one squad's progress directly: the warriors'.
 */
function savedProgress() {
    const saved = readJson(STORAGE_KEY)[ctx.guideId] || {};
    return PATHS.some((path) => path in saved) ? { warrior: saved } : saved;
}

/** The progress of the faction shown (none saved yet: nothing done). */
function loadProgress() {
    ctx.progress.load(savedProgress()[ctx.shownFaction]);
}

function saveProgress() {
    const all = readJson(STORAGE_KEY);
    all[ctx.guideId] = {
        ...savedProgress(),
        faction: ctx.shownFaction,
        [ctx.shownFaction]: ctx.progress.snapshot(),
    };
    writeJson(STORAGE_KEY, all);
}

function commit() {
    saveProgress();
    renderProgress();
}

/** Done (+1: the queue's next step) or Undo (-1: its last done step). */
function advance(path, direction) {
    ctx.progress.advance(path, direction);
    commit();
}

/** A click on a step in a full list: the steps before it done, the step itself and those after it undone. */
function jumpTo(path, position) {
    ctx.progress.jumpTo(path, position);
    commit();
}

/** The "no Gear Blueprint (MR) yet" switch: the 5 ★ steps wait (or come back, in their order). */
function setMrOnHold(value) {
    ctx.progress.setMrOnHold(value);
    commit();
}

/** "All crafted": every crafting step not done yet, in the path's order. */
function craftAll() {
    ctx.progress.craftAll();
    commit();
}

/** Start over: the faction shown only. */
function startOver() {
    ctx.progress.startOver();
    commit();
}

/** Another faction: its heroes and its own progress. */
function setFaction(faction) {
    ctx.shownFaction = faction;
    loadProgress();
    saveProgress();
    render();
}

export { advance, craftAll, jumpTo, loadProgress, savedProgress, setFaction, setMrOnHold, startOver };
