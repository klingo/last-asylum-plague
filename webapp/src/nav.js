import { t, getLocale, setLocale, SUPPORTED_LOCALES } from './lib/i18n';

const LOCALE_LABELS = { en: 'EN', de: 'DE' };

// Remembered across `renderNav()` calls so the "localechange" listener below can re-render
// with the same active page without having to re-derive it from the (about to be replaced) DOM.
let currentActivePage = 'welcome';

/**
 * Renders the shared top navigation bar (including the language switcher) and marks the
 * current page as active. Re-run automatically on every "localechange" event so the nav's
 * own text stays in sync, without each page having to remember to do it.
 */
function renderNav(activePage) {
    currentActivePage = activePage;
    const header = document.querySelector('.app-header');
    if (!header) {
        return;
    }
    const base = import.meta.env.BASE_URL;
    const locale = getLocale();
    const langOptions = SUPPORTED_LOCALES.map(
        (code) =>
            `<option value="${code}" ${code === locale ? 'selected' : ''}>${LOCALE_LABELS[code] || code}</option>`,
    ).join('');
    header.innerHTML = `
        <h1><a href="${base}index.html" class="app-title">${t('app.title')}</a></h1>
        <nav class="app-nav">
            <a href="${base}index.html" class="${activePage === 'welcome' ? 'active' : ''}">${t('nav.home')}</a>
            <a href="${base}analyze.html" class="${activePage === 'analyze' ? 'active' : ''}">${t('nav.analyze')}</a>
            <a href="${base}compare.html" class="${activePage === 'compare' ? 'active' : ''}">${t('nav.compare')}</a>
            <a href="${base}rankings.html" class="${activePage === 'rankings' ? 'active' : ''}">${t('nav.rankings')}</a>
            <a href="${base}choices.html" class="${activePage === 'choices' ? 'active' : ''}">${t('nav.choices')}</a>
        </nav>
        <label class="lang-switch">
            <span class="sr-only">${t('nav.language')}</span>
            <select id="lang-select">${langOptions}</select>
        </label>
    `;

    header.querySelector('#lang-select').addEventListener('change', (event) => {
        setLocale(event.target.value);
    });
}

window.addEventListener('localechange', () => {
    renderNav(currentActivePage);
});

export { renderNav };
