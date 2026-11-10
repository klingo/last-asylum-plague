/**
 * The page's shared state: what `init` loaded and what the sections read, in one object (the modules import it).
 */
const ctx = {
    data: null,
    valuation: null,
    page: null,
    selectedKey: '',
    stepCache: { key: null, steps: null },
    lockCache: { costKey: null, cost: null, searchKey: null, baseline: null, needed: null },
    renderToken: 0,
    valuationKey: null,
};

export { ctx };
