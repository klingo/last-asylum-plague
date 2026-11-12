/**
 * A faction's hero skill guide step by step (`data/hero_skills.json`, Skill Upgrade Path page): the steps in order, every
 * skill's level after a number of steps, what the next step changes, the skill cap of an awakened hero, and a skill's
 * description split into text and the level-dependent numbers.
 *
 * - A hero has four upgradable skills (the slots `auto_attack`, `active`, `ultimate`, `passive`) and the 8-star
 *   `tenacity`, which is Lv 1 and can't be upgraded. A skill starts at Lv 1.
 * - The guide's first phase, the foundation: every upgradable skill of every hero of the faction to the level of the
 *   hero's class (carry 15, tank and support 10), one step per skill, hero by hero in the faction's `foundation_order`,
 *   each hero's skills in the order of the hero's own `path` (skills it doesn't name last, in slot order). Then the
 *   second phase, hero by hero in the faction's `order`, each hero's `path`.
 * - Steps are targets ("ultimate and active to Lv 20"), not increments: a skill that is further already stays. A skill
 *   no step names stays where the foundation left it (a tank's auto attack at 10).
 * - Progress is the number of steps done: the queue is strictly in order.
 *
 * Pure module (no DOM/i18n), shared with Node scripts.
 */

const UPGRADABLE_SLOTS = ['auto_attack', 'active', 'ultimate', 'passive'];
const SKILL_SLOTS = [...UPGRADABLE_SLOTS, 'tenacity'];
const DAMAGE_TYPES = ['energy', 'physical'];
// What a skill is at before any step.
const START_LEVEL = 1;

/** The level the foundation raises a hero of `heroClass` to. */
function foundationLevel(skillData, heroClass) {
    return skillData.foundation[heroClass] ?? START_LEVEL;
}

/** A hero's upgradable skills in the order its `path` first names them, the ones it never names after them. */
function skillOrder(path) {
    const order = [];
    for (const step of path) {
        for (const slot of step.skills) {
            if (!order.includes(slot)) {
                order.push(slot);
            }
        }
    }
    return [...order, ...UPGRADABLE_SLOTS.filter((slot) => !order.includes(slot))];
}

/**
 * The faction's steps in order: `[{ index, phase, hero, skills, level }]`, `phase` 'foundation' or 'path'. `heroes`
 * is the hero map of the pack data (for the classes).
 */
function skillSteps(skillData, heroes, faction) {
    const steps = [];
    const add = (phase, hero, skills, level) => steps.push({ index: steps.length, phase, hero, skills, level });
    for (const hero of skillData.foundation_order[faction] || []) {
        const level = foundationLevel(skillData, heroes[hero]?.class);
        for (const slot of skillOrder(skillData.heroes[hero]?.path || [])) {
            add('foundation', hero, [slot], level);
        }
    }
    for (const hero of skillData.order[faction] || []) {
        for (const step of skillData.heroes[hero]?.path || []) {
            add('path', hero, step.skills, step.level);
        }
    }
    return steps;
}

/** Every upgradable skill of every hero of `steps`, at the start level: `{ hero: { slot: level } }`. */
function startLevels(steps) {
    const levels = {};
    for (const { hero } of steps) {
        levels[hero] ??= Object.fromEntries(UPGRADABLE_SLOTS.map((slot) => [slot, START_LEVEL]));
    }
    return levels;
}

/** The skill levels after the first `done` steps: `{ hero: { slot: level } }`. */
function skillLevels(steps, done) {
    const levels = startLevels(steps);
    for (const step of steps.slice(0, done)) {
        for (const slot of step.skills) {
            levels[step.hero][slot] = Math.max(levels[step.hero][slot], step.level);
        }
    }
    return levels;
}

/**
 * What the next step (`steps[done]`) changes: `{ hero, slots: [slot], level }` with the skills that are below its target
 * (`levels` as of `skillLevels(steps, done)`), or null when all steps are done.
 */
function nextChange(steps, done, levels) {
    const step = steps[done];
    if (!step) {
        return null;
    }
    return {
        hero: step.hero,
        slots: step.skills.filter((slot) => levels[step.hero][slot] < step.level),
        level: step.level,
    };
}

/** The skill cap of a hero with this awakening level: the entry it reaches, else the unawakened `max_level`. */
function skillCap(skillData, awakeningLevel) {
    let cap = skillData.max_level;
    for (const entry of skillData.awakening_caps) {
        if (awakeningLevel >= entry.level) {
            cap = Math.max(cap, entry.cap);
        }
    }
    return cap;
}

/**
 * A skill's description `text` as parts, in order: plain strings, and `{ sign, now, next, unit }` for each `{name}` (the
 * game shows these numbers in green). `now` is the value from `values[name]` (index level - 1), null where it isn't
 * known; `next` the value at `nextLevel` when that is above `level` and the value is known and different, else null;
 * `sign` is the "+" right before the placeholder and `unit` the "%" right after it (both belong to each number,
 * "+522.9% (→ +535.35%)"), else "".
 */
function describeSkill(text, values, level, nextLevel) {
    const parts = [];
    let from = 0;
    for (const match of text.matchAll(/(\+?)\{([a-z][a-z0-9_]*)\}(%?)/g)) {
        const list = values?.[match[2]];
        const now = list?.[level - 1];
        const next = nextLevel > level ? list?.[nextLevel - 1] : null;
        parts.push(text.slice(from, match.index), {
            sign: match[1],
            now: typeof now === 'number' ? now : null,
            next: typeof now === 'number' && typeof next === 'number' && next !== now ? next : null,
            unit: match[3],
        });
        from = match.index + match[0].length;
    }
    parts.push(text.slice(from));
    return parts.filter((part) => part !== '');
}

export {
    DAMAGE_TYPES,
    SKILL_SLOTS,
    START_LEVEL,
    UPGRADABLE_SLOTS,
    describeSkill,
    foundationLevel,
    nextChange,
    skillCap,
    skillLevels,
    skillSteps,
};
