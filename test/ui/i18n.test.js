import './env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import en from '../../webapp/src/i18n/en.json' with { type: 'json' };
import de from '../../webapp/src/i18n/de.json' with { type: 'json' };
import { enumLabel, formatDays, localizedName, setLocale, t, tHtml } from '../../webapp/src/ui/i18n.js';

/** The dictionary's keys in order, as dotted paths. */
function keyPaths(node, prefix = '') {
    return Object.entries(node).flatMap(([key, value]) =>
        value && typeof value === 'object' ? keyPaths(value, `${prefix}${key}.`) : [`${prefix}${key}`],
    );
}

/** The `{placeholders}` of a text, sorted. */
const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

const valueAt = (dictionary, path) => path.split('.').reduce((node, part) => node[part], dictionary);

test('the German dictionary has the English keys, in the same order, with the same placeholders', () => {
    const keys = keyPaths(en);
    assert.deepEqual(keyPaths(de), keys);
    for (const key of keys) {
        assert.deepEqual(placeholders(valueAt(de, key)), placeholders(valueAt(en, key)), key);
    }
});

test('placeholders are filled in, unknown ones stay, a missing key shows as itself', () => {
    setLocale('en');
    assert.equal(t('common.tierSuffix', { tier: 2 }), '(Tier 2)');
    assert.equal(t('common.tierSuffix', {}), '(Tier {tier})');
    assert.equal(t('no.such.key'), 'no.such.key');
});

test('the text is escaped but the placeholders go in as given', () => {
    setLocale('en');
    assert.equal(
        tHtml('common.tierSuffix', { tier: '<strong>2</strong>' }),
        '(Tier <strong>2</strong>)',
        'the caller made the placeholder markup-safe',
    );
    assert.equal(tHtml('events.tickHint'), t('events.tickHint').replaceAll('"', '&quot;'), 'quotes in the text');
    assert.doesNotMatch(tHtml('events.tickHint'), /"/);
    assert.equal(tHtml('common.dash'), '-', 'works without placeholders');
});

test('a language switch changes the texts, a missing translation falls back to English', () => {
    setLocale('de');
    assert.equal(t('weekday.monday'), 'Montag');
    setLocale('en');
    assert.equal(t('weekday.monday'), 'Monday');
});

test('labels of the data codes: a dash for none, the code itself when it has no label', () => {
    setLocale('en');
    assert.equal(enumLabel('weekday', 'friday'), 'Friday');
    assert.equal(enumLabel('weekday', 'friday', 'de'), 'Freitag');
    assert.equal(enumLabel('category', null), '-');
    assert.equal(enumLabel('category', '-'), '-');
    assert.equal(enumLabel('category', 'unlabelled_code'), 'unlabelled_code');
});

test('weekday lists, "any day" for none', () => {
    setLocale('en');
    assert.equal(formatDays(['monday', 'friday']), 'Monday, Friday');
    assert.equal(formatDays([]), 'any day');
    assert.equal(formatDays(undefined), 'any day');
});

test('names of the data come in the language, else English, else whatever there is', () => {
    assert.equal(localizedName({ en: 'Gem', de: 'Edelstein' }, 'de'), 'Edelstein');
    assert.equal(localizedName({ en: 'Gem', de: '' }, 'de'), 'Gem');
    assert.equal(localizedName({ de: 'Edelstein' }, 'en'), 'Edelstein');
    assert.equal(localizedName('Plain'), 'Plain');
    assert.equal(localizedName(undefined), '');
});
