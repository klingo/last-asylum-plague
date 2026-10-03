/**
 * Thin wrapper around the HiGHS solver (WebAssembly, `highs` npm package): builds a model in
 * CPLEX LP text format from a plain JS description and returns primal values + row duals.
 *
 * Model description:
 *   {
 *     sense: 'max' | 'min',
 *     objective: Map<varName, coefficient>,
 *     rows: [{ name, terms: Map<varName, coefficient>, op: '<=' | '>=' | '=', rhs }],
 *     bounds: Map<varName, { lower = 0, upper = Infinity }>,
 *     integers: Set<varName>,   // general integers
 *     binaries: Set<varName>,
 *   }
 * Variable/row names must match /^[a-zA-Z_][a-zA-Z0-9_]*$/ (pack_data ids are safe with a prefix).
 *
 * Pure module: the caller passes an initialized HiGHS instance (see `loadHighs` below, or
 * highs-browser.js in the webapp, which also tells the loader where the .wasm file is served).
 */

let highsPromise = null;

/** Loads HiGHS once (lazily). `loaderOptions` is forwarded to the highs loader (e.g. `locateFile`). */
function loadHighs(loaderOptions = {}) {
    if (!highsPromise) {
        highsPromise = import('highs').then((mod) => (mod.default || mod)(loaderOptions));
    }
    return highsPromise;
}

function num(value) {
    if (!Number.isFinite(value)) {
        throw new Error(`Non-finite LP coefficient: ${value}`);
    }
    // Plain decimal notation (no exponents) for the LP text reader.
    const text = String(Number(value.toPrecision(15)));
    return text.includes('e') ? value.toFixed(20).replace(/\.?0+$/, '') : text;
}

function linearExpression(terms) {
    const parts = [];
    for (const [name, coefficient] of terms) {
        if (coefficient === 0) {
            continue;
        }
        const sign = coefficient < 0 ? '-' : '+';
        parts.push(`${sign} ${num(Math.abs(coefficient))} ${name}`);
    }
    if (parts.length === 0) {
        return null;
    }
    const text = parts.join(' ');
    return text.startsWith('+ ') ? text.slice(2) : text;
}

function toLpText(model) {
    const variables = new Set([...model.objective.keys(), ...model.bounds.keys()]);
    for (const row of model.rows) {
        for (const name of row.terms.keys()) {
            variables.add(name);
        }
    }
    const lines = [model.sense === 'min' ? 'Minimize' : 'Maximize'];
    // An all-zero objective still needs a term for the LP reader.
    const anyVariable = variables.values().next().value;
    lines.push(` obj: ${linearExpression(model.objective) ?? `0 ${anyVariable}`}`);
    lines.push('Subject To');
    for (const row of model.rows) {
        const expr = linearExpression(row.terms);
        if (expr !== null) {
            lines.push(` ${row.name}: ${expr} ${row.op} ${num(row.rhs)}`);
        }
    }
    lines.push('Bounds');
    for (const name of variables) {
        const { lower = 0, upper = Infinity } = model.bounds.get(name) || {};
        const upperText = Number.isFinite(upper) ? num(upper) : '+inf';
        lines.push(` ${num(lower)} <= ${name} <= ${upperText}`);
    }
    if (model.integers?.size) {
        lines.push('Generals', ` ${[...model.integers].join(' ')}`);
    }
    if (model.binaries?.size) {
        lines.push('Binaries', ` ${[...model.binaries].join(' ')}`);
    }
    lines.push('End');
    return lines.join('\n');
}

/**
 * Solves `model` with `highs`. Returns `{ status, objective, values: Map, duals: Map<rowName, dual> }`.
 * Duals are only meaningful for pure LPs (no integers/binaries).
 */
function solveModel(highs, model) {
    const text = toLpText(model);
    const result = highs.solve(text, { output_flag: false });
    const values = new Map();
    for (const [name, column] of Object.entries(result.Columns || {})) {
        values.set(name, column.Primal);
    }
    const duals = new Map();
    for (const row of result.Rows || []) {
        duals.set(row.Name, row.Dual);
    }
    return { status: result.Status, objective: result.ObjectiveValue, values, duals, text };
}

/** Creates an empty model description. */
function createModel(sense) {
    return { sense, objective: new Map(), rows: [], bounds: new Map(), integers: new Set(), binaries: new Set() };
}

/** Adds `coefficient` to `terms[name]`. */
function addTerm(terms, name, coefficient) {
    if (coefficient !== 0 && Number.isFinite(coefficient)) {
        terms.set(name, (terms.get(name) || 0) + coefficient);
    }
}

/** LP-safe name from a prefix and a pack_data id (ids are already [a-z0-9_]). */
function varName(prefix, ...ids) {
    return [prefix, ...ids].join('__').replace(/[^a-zA-Z0-9_]/g, '_');
}

export { loadHighs, solveModel, createModel, addTerm, varName, toLpText };
