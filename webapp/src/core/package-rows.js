/**
 * The purchase rules between packages, shared by both mixed-integer programs (planner.js: the weekly plan,
 * acquire.js: the cheapest plan for needs), added as rows to an lp.js model:
 * - tier N+1 of a ladder only as often as tier N (a higher tier whose paid lower tier isn't on sale can't
 *   be bought at all);
 * - at most one package of each `exclusive_group` (calendar packs) per limit period;
 * - a package that `bundles` others (the Weekly Pass = the single weekly passes): either it or them.
 *
 * `vars`: Map packageId -> `{ name, pkg, capacity, coefficient }` of the model's package variables:
 * `capacity` = most purchases, `coefficient` = purchases one unit of the variable stands for (the planner's
 * weekly share of a monthly pass, 7/30; 1 otherwise).
 *
 * Pure module (no DOM/i18n), shared with Node scripts.
 */
import { varName } from './lp.js';
import { bundledPairs } from './catalog.js';

function addPackageRules(model, vars, packages) {
    const groups = new Map();
    for (const { name, pkg, capacity, coefficient } of vars.values()) {
        if (pkg.exclusive_group) {
            if (!groups.has(pkg.exclusive_group)) {
                groups.set(pkg.exclusive_group, { terms: new Map(), cap: 0 });
            }
            const group = groups.get(pkg.exclusive_group);
            group.terms.set(name, coefficient);
            group.cap = Math.max(group.cap, capacity);
        }
    }
    for (const [groupId, group] of groups) {
        if (Number.isFinite(group.cap)) {
            model.rows.push({ name: varName('grp', groupId), terms: group.terms, op: '<=', rhs: group.cap });
        }
    }

    for (const [bundleId, includedId] of bundledPairs(packages)) {
        const bundle = vars.get(bundleId);
        const included = vars.get(includedId);
        const cap = bundle && included ? Math.max(bundle.capacity, included.capacity) : Infinity;
        if (Number.isFinite(cap)) {
            model.rows.push({
                name: varName('bdl', bundleId, includedId),
                terms: new Map([
                    [bundle.name, bundle.coefficient],
                    [included.name, included.coefficient],
                ]),
                op: '<=',
                rhs: cap,
            });
        }
    }

    for (const [id, { name, pkg }] of vars) {
        if (!pkg.requires) {
            continue;
        }
        const lower = vars.get(pkg.requires);
        if (lower) {
            model.rows.push({
                name: varName('req', id),
                terms: new Map([
                    [name, 1],
                    [lower.name, -1],
                ]),
                op: '<=',
                rhs: 0,
            });
        } else if (packages[pkg.requires]?.price > 0) {
            model.bounds.set(name, { ...model.bounds.get(name), lower: 0, upper: 0 });
        }
    }
}

export { addPackageRules };
