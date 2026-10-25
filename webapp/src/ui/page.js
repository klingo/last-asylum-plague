/**
 * How every page starts: the stylesheet, the nav (with `pageId` marked), the static translations, the pack
 * data, then the page's own `init(data)`. A failed start shows one error card instead of the page.
 *
 * On a language switch the static texts (`data-i18n`) are translated again, then the page's
 * `onLocaleChange()` re-renders the rest; only once `init` has finished, so it never runs on half a page.
 */
import '../style.css';
import { renderNav } from './nav.js';
import { applyStaticTranslations, t } from './i18n.js';
import { loadPackData } from './data.js';
import { escapeHtml } from './html.js';

function showLoadError(error) {
    // The details for whoever looks into it; the page shows a short message.
    // eslint-disable-next-line no-console
    console.error(error);
    document
        .querySelector('main')
        ?.insertAdjacentHTML(
            'afterbegin',
            `<div class="card"><p class="text-bad">${t('common.loadError', { message: escapeHtml(error.message) })}</p></div>`,
        );
}

/** `init(data)`: the page's setup (may be async); `withData: false` for a page without pack data. */
function startPage(pageId, { init = null, onLocaleChange = null, withData = true } = {}) {
    renderNav(pageId);
    applyStaticTranslations();
    let ready = false;
    window.addEventListener('localechange', () => {
        applyStaticTranslations();
        if (ready) {
            onLocaleChange?.();
        }
    });
    (async () => {
        const data = withData ? await loadPackData() : null;
        await init?.(data);
        ready = true;
    })().catch(showLoadError);
}

export { startPage };
