import './style.css';
import { renderNav } from './nav';
import { applyStaticTranslations } from './lib/i18n';

renderNav('welcome');
applyStaticTranslations();

window.addEventListener('localechange', () => applyStaticTranslations());
