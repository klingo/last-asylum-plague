/**
 * The setup bar and the valuation behind a page: mounts the bar (`#valuation-panel`), and values the data
 * (buildValuation) at start and after every settings change, with the loading overlay around it. The page
 * supplies the rest: `render(valuation)` draws it (the settings are `getSettings()`).
 *
 * Options: `fields` (the bar's fields, default all), `overrides()` (extra planner options for a what-if valuation),
 * `prepare()` (runs before each valuation, with the current settings), `render(valuation)` (may be async; the overlay
 * stays up until it is done).
 *
 * Returns `{ panel, recompute }`; `recompute()` values the data again and renders (the first call is the page's
 * own: it doesn't happen on mount).
 */
import { getSettings, onSettingsChange } from './settings.js';
import { mountValuationPanel } from './valuation-panel.js';
import { buildValuation } from './valuation.js';
import { withLoading } from './loading.js';

function mountValuationPage(data, { fields, overrides = () => ({}), prepare = null, render }) {
    const panel = mountValuationPanel(document.getElementById('valuation-panel'), data, fields ? { fields } : {});

    async function recompute() {
        await withLoading(async () => {
            prepare?.();
            const valuation = await buildValuation(data, getSettings(), overrides());
            panel.showRate(valuation);
            await render(valuation);
        });
    }

    onSettingsChange(() => recompute());
    return { panel, recompute };
}

export { mountValuationPage };
