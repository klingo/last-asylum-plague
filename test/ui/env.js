/**
 * A minimal browser stand-in for the ui modules under test: import it first. The page's language is pinned to English
 * (`?lang=en`) and localStorage is an in-memory map (`storage`), so a test starts from a known state.
 */
const storage = new Map();

globalThis.window = {
    location: { search: '?lang=en', href: 'http://localhost/?lang=en', pathname: '/', hash: '' },
    localStorage: {
        getItem: (key) => (storage.has(key) ? storage.get(key) : null),
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
    },
    history: { replaceState() {} },
    dispatchEvent() {},
};
globalThis.document = { documentElement: {} };

export { storage };
