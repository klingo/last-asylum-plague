/**
 * The page's shared state: what `init` loaded and what the sections read, in one object (the modules import it).
 */
const ctx = {
    data: null,
    guideId: null,
    guide: null,
    gearSet: null,
    factions: [],
    shownFaction: null,
    progress: null,
};

export { ctx };
