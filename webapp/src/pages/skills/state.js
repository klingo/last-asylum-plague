import skillData from '../../../../data/hero_skills.json';

/**
 * The page's shared state: what `init` loaded and what the sections read, in one object (the modules import it).
 * `skills` is `data/hero_skills.json`, `steps` the shown faction's steps (core/skill-path.js), `done` how many of them
 * are done, `awakening` the awakening level per hero, `selected` the skill whose details are open (`{ hero, slot }`).
 */
const ctx = {
    data: null,
    skills: skillData,
    factions: [],
    shownFaction: null,
    steps: [],
    done: 0,
    awakening: {},
    selected: null,
    listOpen: false,
};

export { ctx };
