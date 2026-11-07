/**
 * The page's shared state: what `init` loaded and what the sections read, in one object (the modules import it).
 */
const ctx = {
    data: null,
    valuation: null,
    page: null,
    selectedKey: '',
    stepCache: { key: null, steps: null },
    lockCostCache: { key: null, cost: null },
    valuationKey: null,
};

export { ctx };
