import './style.css';
import { renderNav } from './nav';
import { applyStaticTranslations } from './lib/i18n';
import { loadPackData } from './lib/data';

renderNav('welcome');
applyStaticTranslations();

window.addEventListener('localechange', () => {
    applyStaticTranslations();
});

// Only for the footer's "last updated" date; the page works without it.
loadPackData().catch(() => {});
