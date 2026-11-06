/**
 * What the scripts share: where the data files are, reading and writing them in the repository's format (4-space
 * JSON plus a final newline), splitting the command line, and "was this file run directly?" (so a script can export
 * its pure parts for the tests and only run `main()` from the command line).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..', '..');
const PACK_DATA_PATH = path.join(ROOT, 'data', 'pack_data.json');
const LORD_DATA_PATH = path.join(ROOT, 'data', 'lord_specialty.json');
const I18N_DIR = path.join(ROOT, 'webapp', 'src', 'i18n');

/** The JSON in `file`. */
function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** `value` as the repository writes JSON: 4 spaces, a newline at the end. */
function formatJson(value) {
    return `${JSON.stringify(value, null, 4)}\n`;
}

/** Writes `value` to `file` in the repository's JSON format. */
function writeJson(file, value) {
    fs.writeFileSync(file, formatJson(value), 'utf8');
}

/** `{ flags, positional }` of a command line: the `--options` (a Set) and everything else, in order. */
function splitArgs(args) {
    return {
        flags: new Set(args.filter((arg) => arg.startsWith('--'))),
        positional: args.filter((arg) => !arg.startsWith('--')),
    };
}

/** Whether the module `meta` (`import.meta`) is the script node was started with, not an import of it. */
function isMain(meta) {
    return meta.filename === process.argv[1];
}

export { ROOT, PACK_DATA_PATH, LORD_DATA_PATH, I18N_DIR, readJson, writeJson, formatJson, splitArgs, isMain };
