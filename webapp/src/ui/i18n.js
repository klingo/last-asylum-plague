/**
 * Minimal, dependency-free i18n layer for the webapp.
 *
 * UI copy lives in ../i18n/<locale>.json (key/value dictionaries, looked up via `t()`).
 * Translated game data (item/package/exchange shop names) lives directly in pack_data.json
 * as `{ en, de, ... }` objects, resolved via `localizedName()`.
 *
 * Locale resolution order: `?lang=` URL param > localStorage > browser language > default.
 * Switching locale persists the choice and dispatches a `localechange` event on `window` so
 * each page can re-render without a full reload.
 *
 * Markup: translations are plain text. `t()` results go into the page as they are (our own files, no
 * markup in them); a text with markup in its placeholders uses `tHtml()`, which escapes the text itself.
 * Labels of the data's codes (categories, purchase types, weekdays, hero classes, ...) are `<group>.<code>`
 * keys, looked up with `enumLabel()`.
 */
import en from '../i18n/en.json';
import de from '../i18n/de.json';
import { escapeHtml } from './html.js';

// The languages: dictionary and the short name on the language switch. A new language needs its
// i18n/<code>.json here (and its `name.<code>` in pack_data.schema.json's localizedString).
const LOCALES = {
    en: { dictionary: en, label: 'EN' },
    de: { dictionary: de, label: 'DE' },
};
const DICTIONARIES = Object.fromEntries(Object.entries(LOCALES).map(([code, { dictionary }]) => [code, dictionary]));
const SUPPORTED_LOCALES = Object.keys(LOCALES);
const DEFAULT_LOCALE = 'en';
const STORAGE_KEY = 'lasps_locale';

function isSupported(locale) {
    return SUPPORTED_LOCALES.includes(locale);
}

function detectLocale() {
    try {
        const params = new URLSearchParams(window.location.search);
        const urlLocale = params.get('lang');
        if (isSupported(urlLocale)) {
            return urlLocale;
        }
    } catch {
        // ignore
    }

    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (isSupported(stored)) {
            return stored;
        }
    } catch {
        // localStorage may be unavailable (private browsing, etc.)
    }

    const browserLocale = (navigator.language || '').slice(0, 2).toLowerCase();
    if (isSupported(browserLocale)) {
        return browserLocale;
    }

    return DEFAULT_LOCALE;
}

let currentLocale = detectLocale();

function getLocale() {
    return currentLocale;
}

function lookup(dictionary, key) {
    return key
        .split('.')
        .reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), dictionary);
}

/**
 * Resolves a dictionary key for `locale`, treating both a missing key AND an empty-string
 * value as "not translated" and falling back to the English dictionary in either case.
 * Returns `undefined` if English has no (non-empty) value either.
 */
function resolve(locale, key) {
    const primary = lookup(DICTIONARIES[locale], key);
    if (primary) {
        return primary;
    }
    if (locale !== DEFAULT_LOCALE) {
        const fallback = lookup(DICTIONARIES[DEFAULT_LOCALE], key);
        if (fallback) {
            return fallback;
        }
    }
    return undefined;
}

function interpolate(template, vars) {
    if (!vars) {
        return template;
    }
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

/**
 * Looks up a UI copy string by dot-separated key (e.g. "rankings.heading"). Falls back to the
 * English dictionary if the current locale's entry is missing or an empty string, and to the
 * raw key itself if English has no value either.
 */
function t(key, vars) {
    const value = resolve(currentLocale, key) ?? key;
    return interpolate(value, vars);
}

/**
 * A text with markup in some placeholders: the translation is escaped, `vars` are inserted as given (so
 * they must be markup-safe already: escaped names, numbers, tags), e.g. "Reached at {amount}" with
 * `{ amount: '<strong>20'000</strong>' }`.
 */
function tHtml(key, vars = {}) {
    const names = Object.keys(vars);
    // Placeholders stand in for the vars while the text is escaped (control characters never occur in it).
    const tokens = Object.fromEntries(names.map((name, i) => [name, `${i}`]));
    let text = escapeHtml(t(key, tokens));
    names.forEach((name) => {
        text = text.split(tokens[name]).join(String(vars[name]));
    });
    return text;
}

/**
 * Label of a code from the data: `<group>.<code>` (e.g. `enumLabel('category', 'chest')`,
 * `enumLabel('gear.class', 'tank')`). No code or "-" gives a dash; a code without a label shows as is
 * (`npm run i18n:missing` lists those).
 */
function enumLabel(group, code, locale = currentLocale) {
    if (!code || code === '-') {
        return t('common.dash');
    }
    return resolve(locale, `${group}.${code}`) ?? code;
}

/**
 * Resolves a translated data field (e.g. an item/package/shop `name` object) for the
 * current (or given) locale. Falls back to English if the target locale is missing or an
 * empty string, then to any other non-empty value present.
 */
function localizedName(nameField, locale = currentLocale) {
    if (!nameField) {
        return '';
    }
    if (typeof nameField === 'string') {
        return nameField;
    }
    return nameField[locale] || nameField[DEFAULT_LOCALE] || Object.values(nameField).find(Boolean) || '';
}

function formatDays(availableDays, locale = currentLocale) {
    return availableDays && availableDays.length > 0
        ? availableDays.map((day) => enumLabel('weekday', day, locale)).join(', ')
        : t('common.anyDay');
}

function setLocale(locale) {
    if (!isSupported(locale) || locale === currentLocale) {
        return;
    }
    currentLocale = locale;
    try {
        window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
        // ignore
    }
    try {
        const url = new URL(window.location.href);
        url.searchParams.set('lang', locale);
        window.history.replaceState(null, '', `${url.pathname}?${url.searchParams}${url.hash}`);
    } catch {
        // ignore
    }
    document.documentElement.lang = locale;
    window.dispatchEvent(new CustomEvent('localechange', { detail: { locale } }));
}

/**
 * Applies static translations to any element under `root` carrying a `data-i18n` (textContent)
 * or `data-i18n-placeholder` attribute, whose value is a translation key.
 */
function applyStaticTranslations(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
        el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    document.documentElement.lang = currentLocale;
}

export {
    LOCALES,
    SUPPORTED_LOCALES,
    DEFAULT_LOCALE,
    getLocale,
    setLocale,
    t,
    tHtml,
    enumLabel,
    localizedName,
    formatDays,
    applyStaticTranslations,
};
