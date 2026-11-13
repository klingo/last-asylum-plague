/**
 * A faction's hero skill guide step by step (`data/hero_skills.json`, Skill Upgrade Path page): the steps in order, every
 * skill's level after a number of steps, what the next step changes, the skill cap of an awakened hero, a skill with the
 * star bonuses a hero has unlocked, and a skill's description split into text and the level-dependent numbers.
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
 * - A skill's `values` are its numbers without star bonuses. The player's stars (My Heroes page, core/hero-stars.js)
 *   decide which of a skill's star bonuses are unlocked, and the stars of the hero's weapon which of the weapon's bonuses
 *   on the skill; the description then shows what the game shows (`starredSkill`).
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
 * A number with the star bonuses applied: from the highest-star bonus that names it (its `scale` in percent, then its
 * `add`), a later bonus replaces an earlier one ("increases to 100%"). Rounded to one decimal, as the game shows it;
 * an unknown number (null) stays unknown.
 */
function starredValue(base, bonuses, name) {
    const bonus = bonuses.findLast((entry) => entry.scale?.[name] !== undefined || entry.add?.[name] !== undefined);
    if (!bonus || typeof base !== 'number') {
        return base;
    }
    const value = base * (1 + (bonus.scale?.[name] ?? 0) / 100) + (bonus.add?.[name] ?? 0);
    return Math.round(value * 10) / 10;
}

/**
 * The skills the awakening levels of a hero unlock (`awakening_skills`): `[{ level, id, name, description }]`, its own
 * skills by slot resolved (the icon `id`, and the name unless the entry gives its own title); `description` is the
 * entry's, if it has one. None without.
 */
function awakeningSkills(heroEntry) {
    return (heroEntry?.awakening_skills ?? []).map((entry) => {
        const skill = entry.skill ? heroEntry.skills[entry.skill] : entry;
        return { level: entry.level, id: skill.id, name: entry.name ?? skill.name, description: entry.description };
    });
}

const byStars = (a, b) => a.stars - b.stars;

/** The bonuses of the hero's weapon that change the skill in `slot`, in the order of their stars (none without a weapon). */
function weaponBonuses(heroEntry, slot) {
    return (heroEntry?.weapon?.bonuses ?? []).filter((bonus) => bonus.skill === slot).sort(byStars);
}

/**
 * A skill (or the 8-star one) as a hero with `stars` stars and a weapon with `weapon` stars has it:
 * `{ description, values, bonuses, weapon }`. The unlocked bonuses apply in order, the skill's star bonuses first, then
 * the weapon's (`weaponOnSkill`, from `weaponBonuses`: the ones for this skill); the description is the one of the last
 * of them that has its own, else the skill's, and `values` have them applied (`starredValue`). `bonuses` are all the
 * skill's star bonuses and `weapon` all of the weapon's on it, each in the order of their stars with `unlocked`.
 */
function starredSkill(skill, { stars = 0, weapon = 0 } = {}, weaponOnSkill = []) {
    const own = [...(skill.star_bonuses ?? [])].sort(byStars);
    const unlocked = [
        ...own.filter((bonus) => bonus.stars <= stars),
        ...weaponOnSkill.filter((bonus) => bonus.stars <= weapon),
    ];
    const values = Object.fromEntries(
        Object.entries(skill.values ?? {}).map(([name, value]) => [
            name,
            Array.isArray(value)
                ? value.map((base) => starredValue(base, unlocked, name))
                : starredValue(value, unlocked, name),
        ]),
    );
    const description = unlocked.findLast((bonus) => bonus.description)?.description ?? skill.description;
    const listed = (bonuses, reached) => bonuses.map((bonus) => ({ ...bonus, unlocked: bonus.stars <= reached }));
    return { description, values, bonuses: listed(own, stars), weapon: listed(weaponOnSkill, weapon) };
}

/**
 * A skill's description `text` as parts, in order: plain strings, and `{ sign, now, next, unit }` for each `{name}` (the
 * game shows these numbers in green). `now` is the value from `values[name]` (index level - 1, or the one number of a
 * value that doesn't depend on the level), null where it isn't known; `next` the value at `nextLevel` when that is above `level` and the value is known and different, else null;
 * `sign` is the "+" right before the placeholder and `unit` the "%" right after it (both belong to each number,
 * "+522.9% (→ +535.35%)"), else "".
 */
function describeSkill(text, values, level, nextLevel) {
    const parts = [];
    let from = 0;
    // A value is a list by level, or one number for every level.
    const at = (value, n) => (Array.isArray(value) ? value[n - 1] : value);
    for (const match of text.matchAll(/(\+?)\{([a-z][a-z0-9_]*)\}(%?)/g)) {
        const list = values?.[match[2]];
        const now = at(list, level);
        const next = nextLevel > level ? at(list, nextLevel) : null;
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
    awakeningSkills,
    describeSkill,
    foundationLevel,
    nextChange,
    skillCap,
    skillLevels,
    skillSteps,
    starredSkill,
    weaponBonuses,
};
