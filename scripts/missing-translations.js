import fs from 'node:fs';
import path from 'node:path';
import { missingCodeLabels } from './code-labels.js';

const I18N_DIR = path.join(import.meta.dirname, '..', 'webapp', 'src', 'i18n');
const DATA_PATH = path.join(import.meta.dirname, '..', 'data', 'pack_data.json');
const SOURCE_LANG = 'en';

/**
 * Lists missing translations: UI texts (webapp/src/i18n/<lang>.json, compared with en.json), the
 * localized names in data/pack_data.json (`{ "en": "...", "<lang>": "..." }`), and the labels of the
 * data's codes (categories, hero classes, ...: scripts/code-labels.js), also those English lacks. A text
 * is missing when English has it and the language's value is absent or empty.
 *
 * Usage: npm run i18n:missing -- [lang] [--keys-only] [--data-only]
 *        (or node scripts/missing-translations.js [lang] [--keys-only] [--data-only])
 *   lang         e.g. "de"; without it, every language that has a webapp/src/i18n/<lang>.json
 *   --keys-only  print only the keys, not the English text next to them
 *   --data-only  only the data names (pack_data.json), not the UI texts
 */
function main() {
    const args = process.argv.slice(2);
    const keysOnly = args.includes('--keys-only');
    const dataOnly = args.includes('--data-only');
    const requested = args.find((arg) => !arg.startsWith('--'));
    const available = fs
        .readdirSync(I18N_DIR)
        .filter((file) => file.endsWith('.json'))
        .map((file) => path.basename(file, '.json'))
        .filter((lang) => lang !== SOURCE_LANG);
    if (requested && !available.includes(requested)) {
        console.error(`Unknown language "${requested}". Available: ${available.join(', ') || '(none)'}`);
        process.exit(1);
    }
    const languages = requested ? [requested] : available;

    const source = readJson(path.join(I18N_DIR, `${SOURCE_LANG}.json`));
    const data = readJson(DATA_PATH);
    if (!dataOnly) {
        // Labels English lacks too: the page would show the raw code in every language.
        const english = missingCodeLabels(data, source).map((key) => ({ key, english: '' }));
        if (english.length > 0) {
            console.log(`\n=== ${SOURCE_LANG}: ${english.length} missing ===`);
            printSection(`Code labels (webapp/src/i18n/${SOURCE_LANG}.json)`, english, true);
        }
    }
    for (const lang of languages) {
        const target = readJson(path.join(I18N_DIR, `${lang}.json`));
        const ui = dataOnly ? [] : missingUiTexts(source, target);
        const uiKeys = new Set(ui.map(({ key }) => key));
        const labels = dataOnly
            ? []
            : missingCodeLabels(data, target)
                  .filter((key) => !uiKeys.has(key))
                  .map((key) => ({ key, english: '' }));
        const names = missingDataNames(data, lang);
        console.log(`\n=== ${lang}: ${ui.length + labels.length + names.length} missing ===`);
        if (!dataOnly) {
            printSection(`UI texts (webapp/src/i18n/${lang}.json)`, ui, keysOnly);
            if (labels.length > 0) {
                printSection(`Code labels (webapp/src/i18n/${lang}.json, not in en.json either)`, labels, true);
            }
        }
        printSection('Data names (data/pack_data.json)', names, keysOnly);
    }
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Every string leaf of the English UI texts whose translation is absent or empty. */
function missingUiTexts(source, target, prefix = '') {
    const missing = [];
    for (const [key, value] of Object.entries(source)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        const translated = target?.[key];
        if (value && typeof value === 'object') {
            missing.push(...missingUiTexts(value, translated, fullKey));
        } else if (
            typeof value === 'string' &&
            value.trim() &&
            !(typeof translated === 'string' && translated.trim())
        ) {
            missing.push({ key: fullKey, english: value });
        }
    }
    return missing;
}

/** Every localized name in the data (`{ en, ... }`) without a non-empty `lang` value. */
function missingDataNames(node, lang, prefix = '') {
    const missing = [];
    if (!node || typeof node !== 'object') {
        return missing;
    }
    if (typeof node[SOURCE_LANG] === 'string') {
        if (node[SOURCE_LANG].trim() && !(typeof node[lang] === 'string' && node[lang].trim())) {
            missing.push({ key: prefix, english: node[SOURCE_LANG] });
        }
        return missing;
    }
    for (const [key, value] of Object.entries(node)) {
        missing.push(...missingDataNames(value, lang, prefix ? `${prefix}.${key}` : key));
    }
    return missing;
}

function printSection(title, missing, keysOnly) {
    console.log(`\n${title}: ${missing.length} missing`);
    for (const { key, english } of missing) {
        console.log(keysOnly ? `  ${key}` : `  ${key}  ->  ${JSON.stringify(english)}`);
    }
}

main();
