import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const root = import.meta.dirname;

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
        rollupOptions: {
            input: {
                welcome: resolve(root, 'index.html'),
                rankings: resolve(root, 'rankings.html'),
                calendar: resolve(root, 'calendar.html'),
                events: resolve(root, 'events.html'),
                sources: resolve(root, 'sources.html'),
                items: resolve(root, 'items.html'),
                choices: resolve(root, 'choices.html'),
                compare: resolve(root, 'compare.html'),
                spendRewards: resolve(root, 'spend-rewards.html'),
                seasonalPasses: resolve(root, 'seasonal-passes.html'),
                gear: resolve(root, 'gear.html'),
                lordSpecialty: resolve(root, 'lord-specialty.html'),
                settings: resolve(root, 'settings.html'),
            },
        },
    },
});
