import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Relative base so the build works whether it's served from the domain root
// or from a GitHub Pages project path (https://<user>.github.io/<repo>/).
export default defineConfig({
    base: './',
    build: {
        rollupOptions: {
            input: {
                welcome: resolve(__dirname, 'index.html'),
                analyze: resolve(__dirname, 'analyze.html'),
                compare: resolve(__dirname, 'compare.html'),
                rankings: resolve(__dirname, 'rankings.html'),
                choices: resolve(__dirname, 'choices.html'),
            },
        },
    },
});
