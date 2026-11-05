import { defineConfig } from 'vite';
import { basename, resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const root = import.meta.dirname;

// Every HTML file next to this config is a page (a new page needs no entry here).
const pages = Object.fromEntries(
    readdirSync(root)
        .filter((file) => file.endsWith('.html'))
        .map((file) => [basename(file, '.html'), resolve(root, file)]),
);

// When the site last changed: the date of the latest commit (not the build time, so a rebuild without a change keeps
// it). Without git, the build time.
function lastChange() {
    try {
        return execSync('git log -1 --format=%cI', { cwd: root, encoding: 'utf8' }).trim() || new Date().toISOString();
    } catch {
        return new Date().toISOString();
    }
}

// Relative base so the build works whether it's served from the domain root
// or from a GitHub Pages project path (https://<user>.github.io/<repo>/).
export default defineConfig({
    base: './',
    // data/pack_data.json is imported from outside the webapp folder.
    server: { fs: { allow: [resolve(root, '..')] } },
    // The pack data as one JSON.parse'd string (faster than an object literal of that size).
    json: { stringify: true },
    define: { __LAST_CHANGE__: JSON.stringify(lastChange()) },
    build: {
        rollupOptions: { input: pages },
    },
});
