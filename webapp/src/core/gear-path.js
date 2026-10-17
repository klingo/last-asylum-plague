/**
 * A squad's gear upgrade path (`squad_guides` in pack_data.json) step by step: the state of every gear piece
 * of every squad slot after each step, whether a step is possible at that point, and what it costs.
 *
 * - A gear piece has a level (0 to the gear set's `max_level`) and stars. Stars are written as in the game
 *   (0, 0.2, …, 4: four UR stars filled in fifths, then 5 = MR) and counted here as whole steps 0…21, so no
 *   float maths is needed.
 * - The rules of the gear set (`gear_upgrades`): the level is capped by the whole stars
 *   (`level_cap_by_stars`), and working toward a star needs a minimum level (`min_level_for_star`).
 * - Steps are target states ("the carries' swords to Lv 20"), not increments: a step's cost is the cost
 *   table summed from the state before it to its target.
 *
 * Pure module (no DOM/i18n), shared with Node scripts.
 */

const UR_STAR_STEPS = 20; // 4 UR stars in fifths
const MR_STEP = 21; // 5 stars, MR quality

/** Stars as written in the data (0, 0.2, …, 4, 5) -> step 0…21; null if it's no valid number of stars. */
function starStep(stars) {
    if (stars === 5) {
        return MR_STEP;
    }
    const fifths = Math.round(stars * 5);
    return Number.isFinite(stars) && fifths >= 0 && fifths <= UR_STAR_STEPS && Math.abs(stars * 5 - fifths) < 1e-9
        ? fifths
        : null;
}

/** Step 0…21 -> stars as written (2.6, 5). */
function starsOfStep(step) {
    return step === MR_STEP ? 5 : Number((step / 5).toFixed(1));
}

/** Whole stars of a step: 0…4 while UR, 5 at MR. */
function wholeStars(step) {
    return step === MR_STEP ? 5 : Math.floor(step / 5);
}

/**
 * The 5 star icons of a piece (assets/stars/<name>.png): each `N_5_ur` (N fifths filled) or `0_5`. At MR (5 stars) all
 * five are full UR stars; MR shows elsewhere (the piece's border).
 */
function starIcons(step) {
    if (step === MR_STEP) {
        return Array(5).fill('5_5_ur');
    }
    return [0, 1, 2, 3, 4].map((index) => {
        const filled = Math.max(0, Math.min(5, step - index * 5));
        return filled === 0 ? '0_5' : `${filled}_5_ur`;
    });
}

/** 'craft' (`{ item, slot }`: one piece), 'level' or 'stars'. */
function stepKind(step) {
    if (step.item !== undefined || step.craft) {
        return 'craft';
    }
    return step.level !== undefined ? 'level' : 'stars';
}

/** The slots a step is for (`"all"` = the whole squad). */
function stepSlots(guide, step) {
    if (step.slot) {
        return [step.slot];
    }
    return step.slots === 'all' ? Object.keys(guide.slots) : step.slots || [];
}

/** The gear pieces a step is for (`"all"` = the whole gear set). */
function stepItems(gearSet, step) {
    if (step.item) {
        return [step.item];
    }
    const items = step.craft ?? step.items;
    return items === 'all' ? gearSet.items : items || [];
}

/** Nothing crafted yet: slot -> itemId -> { crafted, level, starStep }. */
function initialState(guide, gearSet) {
    return Object.fromEntries(
        Object.keys(guide.slots).map((slot) => [
            slot,
            Object.fromEntries(gearSet.items.map((itemId) => [itemId, { crafted: false, level: 0, starStep: 0 }])),
        ]),
    );
}

function cloneState(state) {
    return Object.fromEntries(
        Object.entries(state).map(([slot, pieces]) => [
            slot,
            Object.fromEntries(Object.entries(pieces).map(([itemId, piece]) => [itemId, { ...piece }])),
        ]),
    );
}

/** The highest level a piece with this star step may have. */
function levelCap(gearSet, step) {
    const stars = Math.min(wholeStars(step), 4);
    return Math.min(gearSet.level_cap_by_stars?.[stars] ?? gearSet.max_level, gearSet.max_level);
}

/**
 * Why a step isn't possible from `state` (empty = it is): `[{ code, slot, item, ... }]`, codes
 * 'unknownSlot', 'unknownItem', 'alreadyCrafted', 'notCrafted', 'aboveMax', 'levelCap'
 * ({ cap, stars }), 'invalidStars', 'starNeedsLevel' ({ star, level }), 'noEffect'.
 */
function checkStep(state, step, guide, gearSet) {
    const problems = [];
    const kind = stepKind(step);
    const target = kind === 'stars' ? starStep(step.stars) : step.level;
    if (kind === 'stars' && target === null) {
        return [{ code: 'invalidStars', stars: step.stars }];
    }
    let changes = 0;
    for (const slot of stepSlots(guide, step)) {
        for (const item of stepItems(gearSet, step)) {
            const piece = state[slot]?.[item];
            if (!state[slot]) {
                problems.push({ code: 'unknownSlot', slot });
                continue;
            }
            if (!piece) {
                problems.push({ code: 'unknownItem', slot, item });
                continue;
            }
            if (kind === 'craft') {
                if (piece.crafted) {
                    problems.push({ code: 'alreadyCrafted', slot, item });
                }
                changes += 1;
                continue;
            }
            if (!piece.crafted) {
                problems.push({ code: 'notCrafted', slot, item });
                continue;
            }
            // A target is a minimum: a piece already there (e.g. "all to Lv 20" after the swords reached Lv 30)
            // just stays as it is.
            const current = kind === 'level' ? piece.level : piece.starStep;
            if (target <= current) {
                continue;
            }
            changes += 1;
            if (kind === 'level') {
                if (target > gearSet.max_level) {
                    problems.push({ code: 'aboveMax', slot, item, max: gearSet.max_level });
                } else if (target > levelCap(gearSet, piece.starStep)) {
                    const cap = levelCap(gearSet, piece.starStep);
                    problems.push({ code: 'levelCap', slot, item, cap, stars: wholeStars(piece.starStep) });
                }
            } else {
                // Every star worked toward on the way needs its minimum level (the piece's level doesn't change).
                const highestStar = target === MR_STEP ? 5 : Math.ceil(target / 5);
                for (let star = wholeStars(current) + 1; star <= highestStar; star += 1) {
                    const needed = gearSet.min_level_for_star?.[star] ?? 0;
                    if (piece.level < needed) {
                        problems.push({ code: 'starNeedsLevel', slot, item, star, level: needed });
                        break;
                    }
                }
            }
        }
    }
    if (problems.length === 0 && changes === 0) {
        problems.push({ code: 'noEffect' });
    }
    return problems;
}

/** The state after a step (whether it's possible or not: see checkStep). */
function applyStep(state, step, guide, gearSet) {
    const next = cloneState(state);
    const kind = stepKind(step);
    for (const slot of stepSlots(guide, step)) {
        for (const item of stepItems(gearSet, step)) {
            const piece = next[slot]?.[item];
            if (!piece) {
                continue;
            }
            if (kind === 'craft') {
                piece.crafted = true;
            } else if (kind === 'level') {
                piece.level = Math.max(piece.level, step.level);
            } else {
                piece.starStep = Math.max(piece.starStep, starStep(step.stars) ?? piece.starStep);
            }
        }
    }
    return next;
}

/** The guide's three paths: `{ craft, level, stars }`, each a list of steps in its own order. */
function guidePaths(guide) {
    return { craft: guide.craft_path || [], level: guide.level_path || [], stars: guide.star_path || [] };
}

/**
 * The three paths merged into one order that keeps every dependency: `[{ index, path, n, step, kind, before,
 * after, problems }]` (`path` + `n`: the step's path and its position there).
 * - Crafting first, all of it: every hero gets their UR gear before anything is upgraded. A piece the crafting
 *   path never crafts gives the steps that need it the problem 'notCrafted'.
 * - Then levels first: the next level step is taken whenever it's possible.
 * - Stars when the levels can't go on (the level cap needs more stars) or are done.
 * If neither the next level step nor the next star step can ever be taken, the remaining steps are added with
 * their problems (e.g. 'levelCap': the star path never reaches the stars that level needs).
 */
function mergePaths(guide, gearSet) {
    const paths = guidePaths(guide);
    const next = { craft: 0, level: 0, stars: 0 };
    let state = initialState(guide, gearSet);
    const merged = [];
    const push = (path, step) => {
        const problems = checkStep(state, step, guide, gearSet);
        const after = applyStep(state, step, guide, gearSet);
        merged.push({
            index: merged.length,
            path,
            n: next[path],
            step,
            kind: stepKind(step),
            before: state,
            after,
            problems,
        });
        next[path] += 1;
        state = after;
    };
    // Where the crafting path (from the next step on) has crafted every piece `step` needs that it ever crafts.
    const craftsFor = (step) => {
        const missing = new Set(
            stepSlots(guide, step).flatMap((slot) =>
                stepItems(gearSet, step)
                    .filter((item) => state[slot]?.[item] && !state[slot][item].crafted)
                    .map((item) => `${slot}:${item}`),
            ),
        );
        let until = next.craft;
        for (let i = next.craft; i < paths.craft.length && missing.size > 0; i += 1) {
            if (missing.delete(`${paths.craft[i].slot}:${paths.craft[i].item}`)) {
                until = i + 1;
            }
        }
        return until;
    };
    // Takes the next step of `path` if it's possible once its pieces are crafted.
    const tryNext = (path) => {
        const step = paths[path][next[path]];
        if (!step) {
            return false;
        }
        const until = craftsFor(step);
        let trial = state;
        for (let i = next.craft; i < until; i += 1) {
            trial = applyStep(trial, paths.craft[i], guide, gearSet);
        }
        // Only the other path can lift these; a piece the crafting path never crafts doesn't block (the step
        // keeps that problem).
        const blocking = checkStep(trial, step, guide, gearSet).filter(
            (problem) => problem.code === 'levelCap' || problem.code === 'starNeedsLevel',
        );
        if (blocking.length > 0) {
            return false;
        }
        while (next.craft < until) {
            push('craft', paths.craft[next.craft]);
        }
        push(path, step);
        return true;
    };
    while (next.craft < paths.craft.length) {
        push('craft', paths.craft[next.craft]);
    }
    while (next.level < paths.level.length || next.stars < paths.stars.length) {
        if (!tryNext('level') && !tryNext('stars')) {
            // Stuck: the rest can't be ordered; craft everything, then add the rest as it is, with its problems.
            while (next.craft < paths.craft.length) {
                push('craft', paths.craft[next.craft]);
            }
            for (const path of ['level', 'stars']) {
                while (next[path] < paths[path].length) {
                    push(path, paths[path][next[path]]);
                }
            }
        }
    }
    while (next.craft < paths.craft.length) {
        push('craft', paths.craft[next.craft]);
    }
    return merged;
}

/**
 * What each level and star step needs from the other of the two, with each path taken in its own order (not the
 * merged one, so a step the other path never makes possible is caught too): `{ level: [...], stars: [...] }`, one
 * entry per step, null if it needs nothing (Lv 44 and below, ...).
 * - a level step above the cap at 0 stars needs whole stars: `{ path: 'stars', n, stars }`;
 * - a star step needs the minimum level of the highest star it works toward: `{ path: 'level', n, level }`.
 * `n` is the first step of the other path after which all of the step's pieces meet that (that path's steps up to
 * there done, on a fully crafted squad), or null if none ever does.
 */
function crossNeeds(guide, gearSet) {
    const paths = guidePaths(guide);
    let crafted = initialState(guide, gearSet);
    for (const step of paths.craft) {
        crafted = applyStep(crafted, step, guide, gearSet);
    }
    const along = (steps) => {
        let state = crafted;
        return steps.map((step) => (state = applyStep(state, step, guide, gearSet)));
    };
    const piecesOf = (step) =>
        stepSlots(guide, step).flatMap((slot) => stepItems(gearSet, step).map((item) => [slot, item]));
    const firstMeeting = (states, step, meets) => {
        const index = states.findIndex((state) => piecesOf(step).every(([slot, item]) => meets(state[slot]?.[item])));
        return index < 0 ? null : index;
    };
    const afterStars = along(paths.stars);
    const afterLevels = along(paths.level);
    // Stars before a star step (its earlier star steps applied), to know which stars it works toward.
    const starsBefore = [crafted, ...afterStars];
    return {
        level: paths.level.map((step) => {
            const stars = [0, 1, 2, 3, 4].find((s) => levelCap(gearSet, s * 5) >= step.level);
            if (!stars) {
                return null;
            }
            const n = firstMeeting(afterStars, step, (piece) => wholeStars(piece?.starStep ?? 0) >= stars);
            return { path: 'stars', n, stars };
        }),
        stars: paths.stars.map((step, i) => {
            const target = starStep(step.stars);
            if (target === null) {
                return null;
            }
            const highestStar = target === MR_STEP ? 5 : Math.ceil(target / 5);
            // From the stars the pieces have before this step: the stars it works toward need their minimum level.
            const lowest = Math.min(
                ...piecesOf(step).map(([slot, item]) => wholeStars(starsBefore[i][slot]?.[item]?.starStep ?? 0)),
            );
            let level = 0;
            for (let star = lowest + 1; star <= highestStar; star += 1) {
                level = Math.max(level, gearSet.min_level_for_star?.[star] ?? 0);
            }
            if (!level) {
                return null;
            }
            const n = firstMeeting(afterLevels, step, (piece) => (piece?.level ?? 0) >= level);
            return { path: 'level', n, level };
        }),
    };
}

/**
 * What a step costs: `{ itemId: qty }` summed over its pieces from `before` to its target, from the gear set's
 * `level_costs` (keyed by the level reached) and `star_costs` (keyed by the stars reached: "0.2", …, "4", "5").
 * Null if a needed entry is missing (the cost tables aren't filled in yet) or for crafting.
 */
function stepCost(before, step, guide, gearSet) {
    const kind = stepKind(step);
    if (kind === 'craft') {
        return null;
    }
    const total = {};
    const add = (costs) => {
        for (const [itemId, qty] of Object.entries(costs)) {
            total[itemId] = (total[itemId] || 0) + qty;
        }
    };
    for (const slot of stepSlots(guide, step)) {
        for (const item of stepItems(gearSet, step)) {
            const piece = before[slot]?.[item];
            if (!piece) {
                continue;
            }
            if (kind === 'level') {
                for (let level = piece.level + 1; level <= step.level; level += 1) {
                    const costs = gearSet.level_costs?.[level];
                    if (!costs) {
                        return null;
                    }
                    add(costs);
                }
            } else {
                for (let s = piece.starStep + 1; s <= (starStep(step.stars) ?? 0); s += 1) {
                    const costs = gearSet.star_costs?.[String(starsOfStep(s))];
                    if (!costs) {
                        return null;
                    }
                    add(costs);
                }
            }
        }
    }
    return total;
}

export {
    MR_STEP,
    starStep,
    starsOfStep,
    wholeStars,
    starIcons,
    stepKind,
    stepSlots,
    stepItems,
    initialState,
    checkStep,
    applyStep,
    guidePaths,
    mergePaths,
    crossNeeds,
    stepCost,
};
