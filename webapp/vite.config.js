import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const root = import.meta.dirname;

// Relative base so the build works whether it's served from the domain root
// or from a GitHub Pages project path (https://<user>.github.io/<repo>/).
export default defineConfig({
    base: './',
    // data/pack_data.json is imported from outside the webapp folder.
    server: { fs: { allow: [resolve(root, '..')] } },
    // The pack data as one JSON.parse'd string (faster than an object literal of that size).
    json: { stringify: true },
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
                gear: resolve(root, 'gear.html'),
            },
        },
    },
});
