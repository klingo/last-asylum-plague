/**
 * Where a player stands in a squad's gear upgrade guide (Gear Upgrade Path page): which steps of the three queues
 * (crafting, levels, stars; gear-path.js) are done, which one is next, what can be done now, and what Done, Undo,
 * "All crafted", a click on a step in a full list and the "no Gear Blueprint (MR) yet" switch do to it.
 *
 * - The steps of a queue are done by their position `n` in it, in the order they were done (for Undo). Steps can be
 *   done out of order within what their requirements allow.
 * - Levels and stars unlock only once crafting is complete; each also needs steps of the other queue (`entry.needs`,
 *   from crossNeeds: Lv 60 needs 4 stars, stars need their minimum level).
 * - The 5 ★ steps wait while there's no Gear Blueprint (MR) (`mrOnHold`).
 *
 * Pure module (no DOM, no storage: the page saves `snapshot()` and hands it back to `load`), shared with the tests.
 */
import { crossNeeds, mergePaths } from './gear-path.js';

const PATHS = ['craft', 'level', 'stars'];
const UPGRADES = ['level', 'stars'];

/**
 * A fresh progress (nothing done) for `guide` on `gearSet`. Returns the merged path entries (`merged`, mergePaths, each
 * upgrade entry with its `needs`), the entries per queue in their own order (`entriesOf`) and the functions below.
 */
function createProgress(guide, gearSet) {
    const merged = mergePaths(guide, gearSet);
    // Each path in its own order (crossNeeds): a step the other path never makes possible gets `n: null` and stays
    // blocked.
    const cross = crossNeeds(guide, gearSet);
    for (const entry of merged) {
        entry.needs = entry.kind === 'craft' ? null : cross[entry.path][entry.n];
    }
    const entriesOf = Object.fromEntries(
        PATHS.map((path) => [path, merged.filter((entry) => entry.path === path).sort((a, b) => a.n - b.n)]),
    );
    const done = { craft: [], level: [], stars: [] };
    let mrOnHold = false;

    const isDone = (entry) => done[entry.path].includes(entry.n);
    const doneCount = (path) => done[path].length;
    const craftComplete = () => doneCount('craft') >= entriesOf.craft.length;
    // A 5 ★ step: it uses the gear set's MR blueprint.
    const isMrStep = (entry) => entry.path === 'stars' && entry.step.stars === 5;
    const isHeld = (entry) => mrOnHold && isMrStep(entry) && !isDone(entry);

    /** A queue's next step: its first step not done yet (and not on hold). */
    function nextOf(path) {
        return entriesOf[path].find((entry) => !isDone(entry) && !isHeld(entry)) || null;
    }

    /** A step can be done now: crafting is complete (for upgrades) and the step it needs from the other queue is done. */
    function canDo(entry) {
        if (entry.kind === 'craft') {
            return true;
        }
        return (
            craftComplete() &&
            (!entry.needs || (entry.needs.n !== null && done[entry.needs.path].includes(entry.needs.n)))
        );
    }

    /** A done step can be undone: crafting only while nothing is upgraded; an upgrade only while no done step needs it. */
    function canUndoEntry(entry) {
        if (entry.kind === 'craft') {
            return doneCount('level') === 0 && doneCount('stars') === 0;
        }
        return !merged.some((other) => isDone(other) && other.needs?.path === entry.path && other.needs.n === entry.n);
    }

    function canAdvance(path) {
        const next = nextOf(path);
        return Boolean(next) && canDo(next);
    }

    /** The step Undo takes back: the queue's last done one. */
    function lastDone(path) {
        const n = done[path].at(-1);
        return n === undefined ? null : entriesOf[path][n];
    }

    function canUndo(path) {
        const last = lastDone(path);
        return Boolean(last) && canUndoEntry(last);
    }

    return {
        merged,
        entriesOf,
        get mrOnHold() {
            return mrOnHold;
        },
        isDone,
        doneCount,
        craftComplete,
        isMrStep,
        isHeld,
        nextOf,
        canDo,
        canUndoEntry,
        canAdvance,
        lastDone,
        canUndo,

        /**
         * Takes over a saved progress (`{ craft, level, stars, mrOnHold }`, or nothing: nothing done). Each queue is a
         * list of done steps; older saves stored a count (the first n steps).
         */
        load(saved = {}) {
            for (const path of PATHS) {
                const list = Array.isArray(saved[path])
                    ? saved[path]
                    : Array.from({ length: Number(saved[path]) || 0 }, (_, n) => n);
                done[path] = [
                    ...new Set(list.filter((n) => Number.isInteger(n) && n >= 0 && n < entriesOf[path].length)),
                ];
            }
            mrOnHold = Boolean(saved.mrOnHold);
            // The guide may have changed since: keep only progress that is still possible.
            if (!craftComplete()) {
                done.level = [];
                done.stars = [];
            }
            let changed = true;
            while (changed) {
                changed = false;
                for (const path of UPGRADES) {
                    const keep = done[path].filter((n) => {
                        const needs = entriesOf[path][n].needs;
                        return !needs || done[needs.path].includes(needs.n);
                    });
                    if (keep.length !== done[path].length) {
                        done[path] = keep;
                        changed = true;
                    }
                }
            }
        },

        /** What to save: `{ craft, level, stars, mrOnHold }` (the steps done per queue, in the order they were done). */
        snapshot() {
            return { craft: done.craft, level: done.level, stars: done.stars, mrOnHold };
        },

        /** Done (+1: the queue's next step) or Undo (-1: its last done step). */
        advance(path, direction) {
            if (direction > 0) {
                if (canAdvance(path)) {
                    done[path].push(nextOf(path).n);
                }
            } else if (canUndo(path)) {
                done[path].pop();
            }
        },

        /**
         * A click on a step in a full list: the steps before it done (as far as allowed; steps on hold stay out), the
         * step itself and those after it undone (as far as allowed).
         */
        jumpTo(path, position) {
            const entries = entriesOf[path];
            let undone = true;
            while (undone) {
                undone = false;
                const latest = [...done[path]].reverse().find((n) => n >= position);
                if (latest !== undefined && canUndoEntry(entries[latest])) {
                    done[path] = done[path].filter((n) => n !== latest);
                    undone = true;
                }
            }
            for (const entry of entries.slice(0, position)) {
                if (isDone(entry) || isHeld(entry)) {
                    continue;
                }
                if (!canDo(entry)) {
                    break;
                }
                done[path].push(entry.n);
            }
        },

        /** The "no Gear Blueprint (MR) yet" switch: the 5 ★ steps wait (or come back, in their order). */
        setMrOnHold(value) {
            mrOnHold = Boolean(value);
        },

        /** "All crafted": every crafting step not done yet, in the path's order. */
        craftAll() {
            for (const entry of entriesOf.craft) {
                if (!isDone(entry)) {
                    done.craft.push(entry.n);
                }
            }
        },

        /** Start over: nothing done (the MR switch stays as it is). */
        startOver() {
            done.craft = [];
            done.level = [];
            done.stars = [];
        },
    };
}

export { createProgress };
