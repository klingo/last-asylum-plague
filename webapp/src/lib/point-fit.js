/**
 * Fits every item's worth in POINTS live from the in-game deal % — the base values item-values.js
 * builds everything else on. Nothing is stored in pack_data.json; only the user's overrides are.
 *
 * A package with deal % D at price P says "my contents are worth P * D / 100 diamonds". With one
 * unknown value per "leaf" item (an item with no structure to derive a value from), every package
 * is one equation, and every exchange-shop offer a weak one ("qty items cost as much as N coins"):
 *
 *   minimize   sum_packages huber(log(points of contents / (P * D / 100)))
 *            + SHOP_WEIGHT * sum_offers huber(log(points of offer / points of its coins))
 *            + RIDGE * sum_items (log value - log prior)^2
 *
 * - Diamonds are the anchor (1 point). Event coins are fitted too, because they tie shop-only items
 *   to the packs, but their fitted value is not used: a currency is worth what it buys.
 * - Items the data says are interchangeable share one value: a single-target `substitutes_for`
 *   (omni shard = shard), and items dropping with the same probability and quantity from the same
 *   random chest (the 12 epigraph IV, UR/SSR gear pieces).
 * - Containers expand the same way item-values.js resolves them; a choice counts its best options
 *   (picked again after each round, starting from the average option).
 * - The robust (Huber) loss keeps outliers like the weekly passes from dragging everything else.
 *   The weak ridge toward a naive prior (each pack's non-diamond value split evenly over its
 *   contents) only decides items the packs can't tell apart; those get a high `uncertainty`.
 * - A `crafted_from` recipe caps an item at its ingredients' worth (strongly: an item is never
 *   worth more than crafting it) and weakly ties it to them (the ratio fills in where the packs say
 *   little, e.g. Lv.1 raven gear; where they're clear, the packs win).
 * - Overrides are pinned (also down their reversible chain), so the rest rebalances around them.
 *   Ignored items are NOT pinned to 0 here — the deal % counts them — they're zeroed later.
 *
 * Solved with Levenberg-Marquardt on log values (deterministic, a few milliseconds).
 * Pure module (no DOM/i18n), shared with Node scripts.
 */
import { expandPackageFamilies, packageFamilyId, currencyItemIds } from './catalog.js';
import { lendReversible } from './item-values.js';

// Obtained through event mechanics the data doesn't model (Moon Coin machine): left out of the
// fit, so they stay unknown.
const UNMODELLED_ITEMS = new Set(['moon_coin', 'star_moon_sigil']);

const ANCHOR_ID = 'diamonds';
const SHOP_WEIGHT = 0.2;
const RECIPE_HINT_WEIGHT = 0.1;
const RECIPE_CAP_WEIGHT = 1;
const HUBER_DELTA = 0.3;
const RIDGE = 0.02;
const CHOICE_ROUNDS = 3;
const MAX_ITERATIONS = 300;
// Log-space standard error above which a fitted value counts as poorly determined (~1.65x).
const UNCERTAIN_ABOVE = 0.5;
// Leave-one-out: a value that moves more than this factor without one pack depends on that pack.
const DEPENDENCE_ABOVE = 1.5;

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length === 0 ? NaN : sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(values, q) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

function substituteTargets(item) {
    return Array.isArray(item.substitutes_for)
        ? item.substitutes_for.map((targetId) => [targetId, 1])
        : Object.entries(item.substitutes_for);
}

function isLeaf(item) {
    return (
        item &&
        !item.value_equivalent &&
        !(item.type === 'random' && Array.isArray(item.drop_table)) &&
        !(item.type === 'choice' && item.choice) &&
        !item.contains &&
        !item.substitutes_for
    );
}

/** Union-find of interchangeable leaf items -> Map itemId -> representative id. */
function tieGroups(items, pinned, currencyIds) {
    const parent = new Map();
    const find = (id) => {
        while (parent.has(id) && parent.get(id) !== id) {
            id = parent.get(id);
        }
        return id;
    };
    const tieable = (id) => isLeaf(items[id]) && !pinned.has(id) && !currencyIds.has(id) && !UNMODELLED_ITEMS.has(id);
    const union = (a, b) => {
        if (tieable(a) && tieable(b) && find(a) !== find(b)) {
            parent.set(find(b), find(a));
        }
    };
    // (Single-target substitutes need no tie: they expand into their target.)
    for (const item of Object.values(items)) {
        if (item.type === 'random' && Array.isArray(item.drop_table)) {
            const byOdds = new Map();
            for (const drop of item.drop_table) {
                const entries = Object.entries(drop.contains || {});
                if (entries.length !== 1) {
                    continue;
                }
                const key = `${drop.probability}|${entries[0][1]}`;
                if (!byOdds.has(key)) {
                    byOdds.set(key, []);
                }
                byOdds.get(key).push(entries[0][0]);
            }
            for (const ids of byOdds.values()) {
                for (const id of ids.slice(1)) {
                    union(ids[0], id);
                }
            }
        }
    }
    return find;
}

/**
 * Expands bundles into `{ terms: Map<param, qty>, constant, skip }`: leaf items become fit
 * parameters, pinned items (anchor, overrides) a constant; `skip` = contains an unmodelled or
 * unknown item.
 */
function createExpander(items, pinned, groupOf, choicePick) {
    function expandInto(acc, contents, factor, visiting) {
        for (const [id, qty] of Object.entries(contents || {})) {
            addItem(acc, id, qty * factor, visiting);
        }
    }

    function addOptions(acc, key, options, selectCount, factor, visiting) {
        const picked = choicePick(key, options, selectCount);
        if (picked === null) {
            for (const option of options) {
                expandInto(acc, option, (factor * selectCount) / options.length, visiting);
            }
        } else {
            for (const index of picked) {
                expandInto(acc, options[index], factor, visiting);
            }
        }
    }

    function addItem(acc, id, qty, visiting) {
        if (qty === 0) {
            return;
        }
        if (pinned.has(id)) {
            acc.constant += qty * pinned.get(id).value;
            return;
        }
        const item = items[id];
        if (UNMODELLED_ITEMS.has(id) || !item || visiting.has(id)) {
            acc.skip = true;
            return;
        }
        visiting.add(id);
        if (item.value_equivalent) {
            expandInto(acc, item.value_equivalent, qty, visiting);
        } else if (item.type === 'random' && Array.isArray(item.drop_table)) {
            for (const drop of item.drop_table) {
                expandInto(acc, drop.contains, qty * drop.probability, visiting);
            }
        } else if (item.type === 'choice' && item.choice) {
            addOptions(acc, id, item.choice.choices || [], item.choice.select_count || 1, qty, visiting);
        } else if (item.contains) {
            expandInto(acc, item.contains, qty, visiting);
        } else if (item.substitutes_for) {
            const options = substituteTargets(item).map(([targetId, n]) => ({ [targetId]: n }));
            addOptions(acc, id, options, 1, qty, visiting);
        } else {
            const param = groupOf(id);
            acc.terms.set(param, (acc.terms.get(param) || 0) + qty);
        }
        visiting.delete(id);
    }

    /** Expands `{ contains, choice }` (a package, or a plain `{ itemId: qty }` via `contains`). */
    return function expand({ contains, choice } = {}, key = null) {
        const acc = { terms: new Map(), constant: 0, skip: false };
        const visiting = new Set();
        expandInto(acc, contains, 1, visiting);
        if (choice) {
            addOptions(acc, key, choice.choices || [], choice.select_count || 1, 1, visiting);
        }
        return acc;
    };
}

function sideValue(side, values) {
    let total = side.constant;
    for (const [param, qty] of side.terms) {
        total += qty * values.get(param);
    }
    return total;
}

function hasValue(side) {
    return side.terms.size > 0 || side.constant > 0;
}

/** Builds the equations for one round of choice picks. */
function buildEquations(data, packages, expand, currencyIds, excludeFamilies = null) {
    const equations = [];
    const seen = new Set();
    for (const [id, pkg] of Object.entries(packages)) {
        if (pkg.deal_percentage == null || !(pkg.price > 0) || excludeFamilies?.has(packageFamilyId(id, pkg))) {
            continue;
        }
        const lhs = expand(pkg, `package:${id}`);
        const target = (pkg.price * pkg.deal_percentage) / 100;
        if (lhs.skip || lhs.terms.size === 0) {
            continue;
        }
        // Tiers of one family usually scale the same contents: count them once.
        const signature = [...lhs.terms]
            .map(([param, qty]) => `${param}:${(qty / target).toPrecision(6)}`)
            .sort()
            .concat((lhs.constant / target).toPrecision(6))
            .join('|');
        if (seen.has(signature)) {
            continue;
        }
        seen.add(signature);
        equations.push({ kind: 'package', id, lhs, rhs: { terms: new Map(), constant: target }, weight: 1 });
    }
    for (const [shopId, shop] of Object.entries(data.exchange_shops || {})) {
        const currencyId = shop.currency_item_id;
        if (UNMODELLED_ITEMS.has(currencyId)) {
            continue;
        }
        for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
            if (currencyIds.has(offer.item_id)) {
                continue;
            }
            const lhs = expand({ contains: { [offer.item_id]: offer.quantity } });
            const rhs = expand({ contains: { [currencyId]: offer.currency_cost } });
            if (lhs.skip || rhs.skip || lhs.terms.size + rhs.terms.size === 0 || !hasValue(lhs) || !hasValue(rhs)) {
                continue;
            }
            equations.push({ kind: 'offer', id: `${shopId}:${offerKey}`, lhs, rhs, weight: SHOP_WEIGHT });
        }
    }
    for (const [id, item] of Object.entries(data.items || {})) {
        if (!item.crafted_from) {
            continue;
        }
        const lhs = expand({ contains: { [id]: 1 } });
        const rhs = expand({ contains: item.crafted_from });
        if (lhs.skip || rhs.skip || lhs.terms.size + rhs.terms.size === 0 || !hasValue(lhs) || !hasValue(rhs)) {
            continue;
        }
        equations.push({ kind: 'recipe', id, lhs, rhs, weight: RECIPE_HINT_WEIGHT, capWeight: RECIPE_CAP_WEIGHT });
    }
    return equations;
}

/** Naive starting point / ridge target per parameter (log space). */
function priorValues(params, equations) {
    const guesses = new Map(params.map((p) => [p, []]));
    for (const eq of equations.filter((e) => e.kind === 'package')) {
        const rest = Math.max(eq.rhs.constant - eq.lhs.constant, eq.rhs.constant * 0.1);
        for (const [param, qty] of eq.lhs.terms) {
            guesses.get(param).push(rest / eq.lhs.terms.size / qty);
        }
    }
    const prior = new Map();
    for (const [param, list] of guesses) {
        if (list.length) {
            prior.set(param, median(list));
        }
    }
    // Shop-only items: price them through currencies that already have a guess.
    for (let pass = 0; pass < 3; pass++) {
        for (const eq of equations.filter((e) => e.kind === 'offer')) {
            const known = (side) => [...side.terms.keys()].every((p) => prior.has(p));
            const unknownOn = (side) => [...side.terms.keys()].filter((p) => !prior.has(p));
            for (const [own, other] of [
                [eq.lhs, eq.rhs],
                [eq.rhs, eq.lhs],
            ]) {
                const missing = unknownOn(own);
                if (missing.length === 0 || !known(other)) {
                    continue;
                }
                const rest = Math.max(sideValue(other, prior) - own.constant, 0);
                for (const param of missing) {
                    if (rest > 0) {
                        prior.set(param, rest / missing.length / own.terms.get(param));
                    }
                }
            }
        }
    }
    const fallback = Math.exp(median([...prior.values()].map(Math.log)));
    return new Map(params.map((p) => [p, Math.log(prior.get(p) ?? (Number.isFinite(fallback) ? fallback : 1))]));
}

/** Cholesky factor of a symmetric positive-definite matrix (array of rows), or null. */
function cholesky(a) {
    const n = a.length;
    const l = a.map(() => new Float64Array(n));
    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
            let sum = a[i][j];
            for (let k = 0; k < j; k++) {
                sum -= l[i][k] * l[j][k];
            }
            if (i === j) {
                if (!(sum > 0)) {
                    return null;
                }
                l[i][i] = Math.sqrt(sum);
            } else {
                l[i][j] = sum / l[j][j];
            }
        }
    }
    return l;
}

function choleskySolve(l, b) {
    const n = b.length;
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        let sum = b[i];
        for (let k = 0; k < i; k++) {
            sum -= l[i][k] * y[k];
        }
        y[i] = sum / l[i][i];
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
        let sum = y[i];
        for (let k = i + 1; k < n; k++) {
            sum -= l[k][i] * x[k];
        }
        x[i] = sum / l[i][i];
    }
    return x;
}

function huber(r) {
    const a = Math.abs(r);
    return a <= HUBER_DELTA ? r * r : 2 * HUBER_DELTA * a - HUBER_DELTA * HUBER_DELTA;
}

/**
 * Levenberg-Marquardt on log values. Returns `{ theta, normal }` where `normal` is the final
 * weighted normal matrix (for standard errors).
 */
function solveLogFit(params, equations, prior, initial = null) {
    const n = params.length;
    const index = new Map(params.map((p, i) => [p, i]));
    const rows = equations.map((eq) => ({
        weight: eq.weight,
        lhs: [...eq.lhs.terms].map(([p, q]) => [index.get(p), q]),
        lhsConst: eq.lhs.constant,
        rhs: [...eq.rhs.terms].map(([p, q]) => [index.get(p), q]),
        rhsConst: eq.rhs.constant,
        capWeight: eq.capWeight ?? null,
    }));
    // Rows with a cap weight (recipes) weigh more once the item exceeds its ingredients.
    const rowWeight = (row, residual) => (row.capWeight !== null && residual > 0 ? row.capWeight : row.weight);
    const priorVec = Float64Array.from(params, (p) => prior.get(p));

    function evaluate(theta) {
        const exp = theta.map(Math.exp);
        let cost = 0;
        const residuals = [];
        for (const row of rows) {
            const l = row.lhs.reduce((s, [i, q]) => s + q * exp[i], row.lhsConst);
            const r = row.rhs.reduce((s, [i, q]) => s + q * exp[i], row.rhsConst);
            const residual = Math.log(l / r);
            residuals.push({ residual, l, r });
            cost += rowWeight(row, residual) * huber(residual);
        }
        for (let i = 0; i < n; i++) {
            cost += RIDGE * (theta[i] - priorVec[i]) ** 2;
        }
        return { cost, residuals, exp };
    }

    function normalEquations(theta, state) {
        const a = Array.from({ length: n }, () => new Float64Array(n));
        const g = new Float64Array(n);
        rows.forEach((row, j) => {
            const { residual, l, r } = state.residuals[j];
            const abs = Math.abs(residual);
            const w = rowWeight(row, residual) * (abs <= HUBER_DELTA ? 1 : HUBER_DELTA / abs);
            const grad = new Map();
            for (const [i, q] of row.lhs) {
                grad.set(i, (grad.get(i) || 0) + (q * state.exp[i]) / l);
            }
            for (const [i, q] of row.rhs) {
                grad.set(i, (grad.get(i) || 0) - (q * state.exp[i]) / r);
            }
            for (const [i, gi] of grad) {
                g[i] += w * gi * residual;
                for (const [k, gk] of grad) {
                    a[i][k] += w * gi * gk;
                }
            }
        });
        for (let i = 0; i < n; i++) {
            a[i][i] += RIDGE;
            g[i] += RIDGE * (theta[i] - priorVec[i]);
        }
        return { a, g };
    }

    let theta = Float64Array.from(params, (p, i) => (initial?.has(p) ? Math.log(initial.get(p)) : priorVec[i]));
    let state = evaluate(theta);
    let damping = 1e-3;
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        const { a, g } = normalEquations(theta, state);
        let accepted = false;
        while (damping < 1e10) {
            const damped = a.map((row, i) => {
                const copy = Float64Array.from(row);
                copy[i] += damping * row[i];
                return copy;
            });
            const l = cholesky(damped);
            if (!l) {
                damping *= 10;
                continue;
            }
            const step = choleskySolve(
                l,
                g.map((v) => -v),
            );
            const candidate = theta.map((v, i) => v + step[i]);
            const next = evaluate(candidate);
            if (next.cost <= state.cost) {
                const maxStep = Math.max(...step.map(Math.abs));
                const improvement = state.cost - next.cost;
                theta = candidate;
                state = next;
                damping = Math.max(damping / 3, 1e-9);
                accepted = maxStep > 1e-9 && improvement > 1e-12 * (1 + state.cost);
                break;
            }
            damping *= 4;
        }
        if (!accepted) {
            break;
        }
    }
    return { theta, state, normal: normalEquations(theta, state).a };
}

/**
 * Fits the base points of all leaf items.
 * - `overrides`: `{ itemId: points }` set by the user; pinned in the fit.
 * - `excludeFamilies`: Set of package family ids left out (fitSensitivity).
 * - `initialValues`: Map parameter -> value to start from (a previous fit's `paramValues`).
 * Returns `{ points, diagnostics, paramValues }`:
 * - `points`: Map itemId -> `{ value, source: 'fit'|'override'|'reversible', uncertainty?, support? }`
 *   (pass it to item-values.js as `basePoints`); currencies are not included.
 * - `diagnostics`: `{ packages: [{ id, ratio }], medianError, p90Error, parameters, equations }`
 *   where ratio = fitted contents / what the deal % says (1 = exact).
 */
function fitItemPoints(data, { overrides = {}, excludeFamilies = null, initialValues = null } = {}) {
    const items = data.items || {};
    const packages = expandPackageFamilies(data.packages || {});
    const currencyIds = currencyItemIds(data.exchange_shops);

    const pinned = new Map([[ANCHOR_ID, { value: 1, source: 'anchor' }]]);
    for (const [id, value] of Object.entries(overrides || {})) {
        if (items[id] && !currencyIds.has(id) && Number.isFinite(value) && value >= 0) {
            pinned.set(id, { value, source: 'override' });
        }
    }
    lendReversible(items, pinned);
    const groupOf = tieGroups(items, pinned, currencyIds);

    let values = initialValues;
    const choicePick = (key, options, selectCount) => {
        if (values === null) {
            return null;
        }
        return options
            .map((option, index) => ({ index, value: sideValue(expandPlain({ contains: option }), values) }))
            .sort((a, b) => b.value - a.value)
            .slice(0, selectCount)
            .map((option) => option.index);
    };
    const expand = createExpander(items, pinned, groupOf, choicePick);
    // Option values for picking: a plain expansion with the same picks, unknown parts ignored.
    const expandPlain = (bundle) => {
        const side = expand(bundle);
        side.terms = new Map([...side.terms].filter(([param]) => values.has(param)));
        return side;
    };

    let fit = null;
    let equations = [];
    let params = [];
    // Warm-started fits already know the best choice picks: one round is enough.
    const rounds = initialValues ? 1 : CHOICE_ROUNDS;
    for (let round = 0; round < rounds; round++) {
        equations = buildEquations(data, packages, expand, currencyIds, excludeFamilies);
        params = [...new Set(equations.flatMap((eq) => [...eq.lhs.terms.keys(), ...eq.rhs.terms.keys()]))].sort();
        const prior = priorValues(params, equations);
        fit = solveLogFit(params, equations, prior, values);
        values = new Map(params.map((p, i) => [p, Math.exp(fit.theta[i])]));
    }

    // Standard errors: diagonal of the inverse normal matrix, scaled by the residual spread.
    const packageResiduals = fit.state.residuals.filter((_, j) => equations[j].kind === 'package');
    const sigma = Math.max(1.4826 * median(packageResiduals.map((r) => Math.abs(r.residual))), 0.05);
    const factor = params.length ? cholesky(fit.normal) : null;
    const uncertainty = new Map();
    params.forEach((param, i) => {
        if (!factor) {
            uncertainty.set(param, Infinity);
            return;
        }
        const unit = new Float64Array(params.length);
        unit[i] = 1;
        uncertainty.set(param, Math.sqrt(Math.max(choleskySolve(factor, unit)[i], 0)) * sigma);
    });
    // Equations per parameter: packages (deal %) vs. weak hints (shop offers, recipes).
    const support = new Map(params.map((p) => [p, { packages: 0, hints: 0 }]));
    for (const eq of equations) {
        for (const param of new Set([...eq.lhs.terms.keys(), ...eq.rhs.terms.keys()])) {
            support.get(param)[eq.kind === 'package' ? 'packages' : 'hints']++;
        }
    }

    const points = new Map();
    for (const [id, entry] of pinned) {
        if (id !== ANCHOR_ID) {
            points.set(id, entry);
        }
    }
    for (const id of Object.keys(items)) {
        const param = groupOf(id);
        if (points.has(id) || currencyIds.has(id) || !values.has(param) || !isLeaf(items[id])) {
            continue;
        }
        const se = uncertainty.get(param);
        points.set(id, {
            value: values.get(param),
            source: 'fit',
            uncertainty: se,
            uncertain: !(se <= UNCERTAIN_ABOVE),
            support: support.get(param),
        });
    }

    const packageRatios = [];
    equations.forEach((eq, j) => {
        if (eq.kind === 'package') {
            packageRatios.push({ id: eq.id, ratio: Math.exp(fit.state.residuals[j].residual) });
        }
    });
    const errors = packageRatios.map((p) => Math.abs(p.ratio - 1));
    return {
        points,
        paramValues: values,
        diagnostics: {
            packages: packageRatios,
            medianError: median(errors),
            p90Error: quantile(errors, 0.9),
            parameters: params.length,
            equations: equations.length,
        },
    };
}

/** Package families with a deal % (the units fitSensitivity leaves out). */
function sensitivityFamilies(data) {
    const packages = expandPackageFamilies(data.packages || {});
    const families = Object.entries(packages)
        .filter(([, pkg]) => pkg.deal_percentage != null && pkg.price > 0)
        .map(([id, pkg]) => packageFamilyId(id, pkg));
    return [...new Set(families)];
}

/**
 * Leave-one-out sensitivity of a fit (`base` = fitItemPoints' result for the same overrides):
 * refits without each package family in `families` and records per fitted item the largest change
 * `{ factor, family }` (factor Infinity = the item has no value at all without that family).
 * Accumulates into `into`, so callers can run it in chunks. The flag: `isDependent(entry)`.
 */
function fitSensitivity(data, base, { overrides = {}, families = sensitivityFamilies(data), into = new Map() } = {}) {
    for (const family of families) {
        const refit = fitItemPoints(data, {
            overrides,
            excludeFamilies: new Set([family]),
            initialValues: base.paramValues,
        });
        for (const [id, entry] of base.points) {
            if (entry.source !== 'fit' || !(entry.value > 0)) {
                continue;
            }
            const other = refit.points.get(id)?.value;
            const factor = other > 0 ? Math.exp(Math.abs(Math.log(other / entry.value))) : Infinity;
            if (!into.has(id) || factor > into.get(id).factor) {
                into.set(id, { factor, family });
            }
        }
    }
    return into;
}

function isDependent(sensitivity) {
    return Boolean(sensitivity) && sensitivity.factor > DEPENDENCE_ABOVE;
}

export { fitItemPoints, fitSensitivity, sensitivityFamilies, isDependent, UNMODELLED_ITEMS };
