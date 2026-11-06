/**
 * Where the site is served from (Vite's `base`: "/" in dev, the repository path on GitHub Pages). Node, where the
 * tests import the ui modules, has no `import.meta.env`: the root then.
 */
const BASE_URL = typeof import.meta.env === 'undefined' ? '/' : import.meta.env.BASE_URL;

export { BASE_URL };
