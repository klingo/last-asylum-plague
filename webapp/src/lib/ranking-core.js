/**
 * Browser-safe port of scripts/build-item-value-index.js + scripts/rank-packages.js,
 * computed live from the raw pack data (no pre-generated output/*.json files involved).
 * Ranks every package AND every exchange shop offer (including bonus tiers) by how much
 * value they provide relative to their price, using each item's cheapest known Banknotes
 * cost (see lib/pricing-core.js `createMarket`).
 *
 * "Value" of a purchase option is the sum of (quantity * item.unit_cost) for every item it
 * contains. For "choice" blocks (pick N of several options), the best N choices are assumed,
 * matching the optimistic approach the item-analysis page already uses for yield
 * calculations. "value_ratio" (value / price) is the ranking metric: options that return
 * more value per Banknote spent rank higher, i.e. they are the best deals to prioritize
 * buying. Purchase limits are intentionally ignored for this "unit cost" (a fresh market is
 * peeked, never purchased from), since it represents the theoretical cheapest market price
 * of an item, independent of how many can actually be bought.
 *
 * A package/bonus tier is never allowed to count as evidence for its own contents' worth: for
 * each one, its contents are priced against a snapshot built with THAT ONE bundle excluded from
 * the start (see `buildFairPriceMap`'s `exclude` parameter). If an item still has no OTHER known source
 * anywhere (only ever sold as part of this exact bundle), it can't be priced independently;
 * rather than crediting it with the bundle's entire price (which would make e.g. a
 * 9999-Banknote bundle handing over six different items read as "each of those six items
 * individually costs 9999"), whatever price is left over after paying the bundle's OTHER
 * contents their real market rate is split evenly across those exclusive items (`valueOfBundle`).
 * If the resolvable contents alone already account for the full price, exclusive items get 0
 * — there's no room left in the price to attribute to them. This computation is entirely
 * local to each bundle (no bundle's valuation depends on any other bundle's OUTPUT), so unlike
 * a globally self-consistent solve there's no possibility of cross-bundle feedback loops or
 * numerical instability; the trade-off is that items exclusive to more than one otherwise-poorly-
 * connected bundle are priced independently per bundle rather than reconciled against each other.
 */

import { Matrix, solve as solveLinearSystem } from 'ml-matrix';
import { createMarket, packageDisplayName } from './pricing-core';
import { localizedName, t } from './i18n';
import { formatThousands } from './format';

function getUnitCost(market, itemId) {
    const cost = market.peekUnitCost(itemId);
    return Number.isFinite(cost) ? cost : null;
}

/**
 * Values a flat `{itemId: qty}` map against `price`, pricing each item via `excludingMarket`
 * (see module header). See module header for the exclusive-item residual-split rule.
 *
 * Any item in `excludeItemIds` is still priced (informationally) and still gets its own
 * breakdown row, but always contributes 0 to `total` and never enters the exclusive-item
 * residual split — it's a deliberate opt-out from the value calculation, not a missing price,
 * so it doesn't affect `complete` either.
 */
function valueOfBundle(contentsMap, price, excludingMarket, items, locale, excludeItemIds) {
    const resolvable = [];
    const exclusive = [];
    const excluded = [];

    for (const [itemId, qty] of contentsMap) {
        if (excludeItemIds?.has(itemId)) {
            excluded.push({ itemId, qty });
            continue;
        }
        const unitCost = getUnitCost(excludingMarket, itemId);
        if (unitCost === null) {
            exclusive.push({ itemId, qty });
        } else {
            resolvable.push({ itemId, qty, unitCost });
        }
    }

    let total = 0;
    const breakdown = [];
    for (const { itemId, qty, unitCost } of resolvable) {
        const value = qty * unitCost;
        total += value;
        breakdown.push({
            item_id: itemId,
            name: localizedName(items[itemId]?.name, locale) || itemId,
            quantity: qty,
            unit_cost: unitCost,
            value: Number(value.toFixed(6)),
            known: true,
        });
    }

    if (exclusive.length > 0) {
        const residual = Math.max(0, price - total);
        const perItemShare = residual / exclusive.length;
        for (const { itemId, qty } of exclusive) {
            total += perItemShare;
            breakdown.push({
                item_id: itemId,
                name: localizedName(items[itemId]?.name, locale) || itemId,
                quantity: qty,
                unit_cost: perItemShare / qty,
                value: Number(perItemShare.toFixed(6)),
                known: false,
            });
        }
    }

    for (const { itemId, qty } of excluded) {
        const unitCost = getUnitCost(excludingMarket, itemId);
        breakdown.push({
            item_id: itemId,
            name: localizedName(items[itemId]?.name, locale) || itemId,
            quantity: qty,
            unit_cost: unitCost,
            value: 0,
            known: true,
        });
    }

    return { total, complete: exclusive.length === 0, breakdown };
}

/**
 * A package's own directly-declared contents: `contains` plus whichever `choice` branch(es)
 * currently look best (top `select_count`), priced via `excludingMarket`. Matches the
 * optimistic "assume the best choices" approach the item-analysis page already uses.
 */
function mergedContentsOf(pkg, excludingMarket) {
    const merged = new Map();
    const add = (id, qty) => merged.set(id, (merged.get(id) || 0) + qty);

    if (pkg.contains) {
        for (const [id, qty] of Object.entries(pkg.contains)) add(id, qty);
    }
    if (pkg.choice?.choices?.length) {
        const selectCount = pkg.choice.select_count || 1;
        const scored = pkg.choice.choices
            .map((choiceEntry) => {
                let total = 0;
                for (const [id, qty] of Object.entries(choiceEntry)) {
                    const v = getUnitCost(excludingMarket, id);
                    total += v !== null ? qty * v : 0;
                }
                return { choiceEntry, total };
            })
            .sort((a, b) => b.total - a.total);
        for (const { choiceEntry } of scored.slice(0, selectCount)) {
            for (const [id, qty] of Object.entries(choiceEntry)) add(id, qty);
        }
    }
    return merged;
}

// ---- Bundle-aware ("fair") pricing ---------------------------------------------------------
// This is how the Value Ranking page prices every package/bonus-tier's own contents — a
// self-contained algorithm, local to this file, that never touches pricing-core.js's
// `createMarket`/`peekUnitCost` (reused here only for a separate purpose — see `currencyMarket`
// in `buildRanking`), so Analyze/Purchase Plan/Choices are entirely unaffected by it.
//
// The problem: `peekUnitCost` prices an item as `min(package.price / thatItem'sYieldFromPackage)`
// across every package yielding it — i.e. it credits a package's ENTIRE price to a single item
// it hands over, ignoring everything else that same purchase also gives you. That's a fine
// approximation for a package that's essentially "one item + filler," but badly over-prices a
// genuine multi-item bundle whenever it's used as a comparison source for pricing just ONE of
// its own components: e.g. a 1999-Banknote pass bundling 6 different rewards makes each of
// those rewards look like it alone costs up to 1999, wildly inflating the computed value of any
// narrower single-item package selling one of the same rewards.
//
// The fix has two tiers. First, apportion each bundle's price across everything it hands over,
// crediting an item only with the LEFTOVER price after paying for the bundle's other contents at
// THEIR own already-settled rate — the same "residual" principle `valueOfBundle` already uses
// for items with no other source at all, generalized here into the market-pricing step itself.
//
// Doing this correctly requires an item to only ever be priced via a bundle once every OTHER
// item that bundle also yields already has a final, settled price — otherwise the residual is
// just a guess that could later turn out to have been computed from incomplete information,
// with no way to retract it (an earlier iterative-refinement version of this function had
// exactly that bug: an early low-quality estimate could never be un-set once something better
// was learned later). So this resolves items with a Dijkstra-style greedy solve: repeatedly
// settle whichever not-yet-settled item currently has the cheapest available candidate price,
// where a bundle only OFFERS a candidate for its one remaining unsettled item once every other
// item it contains has already been settled. Every settlement is therefore final the moment
// it's made — one pass, no iteration count or processing order to reason about.
//
// Not every candidate is equally trustworthy, though: a DIRECT single-item exchange offer (an
// offer only ever declares one item type, so there's no residual involved — the posted rate IS
// the price) is real, verifiable market evidence, whereas a package's residual is an INFERENCE
// that's only as good as the assumption the package isn't specifically discounting or padding
// that one component. A single generous "loss leader" bundle can make its bonus item look
// arbitrarily cheap by residual alone. So when both a direct and a residual candidate exist for
// the same item, the direct one wins outright, even if the residual looks numerically cheaper —
// see `exhaustGenuineSettlements` for exactly how (and why this doesn't break the "settle once,
// never revisit" finality above).
//
// A bundle whose OTHER contents, at their settled rate, already account for its entire price
// contributes NO usable candidate for whatever's left (a non-positive residual isn't "free," it
// just means this bundle is uninformative about that item's price) — that item is simply not
// settled by this first tier.
//
// Second tier: this dataset has a LOT of items that never reach "exactly one unsettled item" in
// any bundle, because every bundle they appear in also has at least one OTHER item with no clean
// source either — this is common, not a rare edge case (see `regressionFill`'s header for the
// details and why a per-item naive credit doesn't work here). Those get priced jointly, all at
// once, by a regularized least-squares fit across every remaining bundle — see `regressionFill`.
//
// Only "pure" bundles participate as pricing sources: exchange offers (always exactly one
// declared item type per offer) and `contains`-only packages/bonus tiers. Packages with a
// `choice` block are deliberately excluded from being a pricing SOURCE for other items — which
// option(s) they'd yield depends on prices that are themselves still being solved for, a
// circularity not worth taking on for the small fraction of packages that use `choice`; they're
// still valued normally (via `mergedContentsOf`/`valueOfBundle`) against whatever this
// produces, same as any other package.
//
// `category: "weekly_pass"` packages (a "diamonds plus one themed reward" subscription shape —
// era_of_revival_raven_essence_weekly_pass, weekly_grain/herb/timber/hero_exp_pass, and the
// combined weekly_pass) are excluded from being a pricing SOURCE the same way: diamonds are a
// near-universal, heavily-anchored item, so a bundle that's essentially "diamonds plus one other
// thing" tends to price at (or below) diamonds' own rate, leaving almost nothing in residual for
// the themed reward — that's a subscription/engagement pricing pattern, not evidence of the
// reward's actual worth (found in practice: raven_essence priced this way came out ~10,000x below
// its own posted exchange-shop rate). They're still valued normally against whatever the rest of
// the graph determines, same as `choice` packages.
//
// An exchange offer/bonus tier's OWN bundle price is `currency_cost * currencyUnitCost` — so a
// shop's currency needs a price before its offers/bonus tiers can become candidate bundles at
// all. That price has to be trustworthy: crediting a whole sibling package's price to the
// currency alone reintroduces the exact distortion this algorithm exists to avoid, and once
// baked into a bundle's price it poisons every genuine settlement that bundle goes on to produce
// (e.g. a bonus tier trading an overpriced currency for a single item hands that item the
// bundle's ENTIRE, inflated price with nothing to net it against). So a shop's currency is only
// used to build offer/bonus-tier bundles once it has settled GENUINELY, via a throwaway
// packages-only bootstrap pass run before anything else — a currency that pass can't settle is
// left out of the solve entirely rather than trusted. Items only reachable through such a shop
// simply stay unsettled here and correctly fall through to `valueOfBundle`'s existing "exclusive
// item" residual-split when their own package/bonus-tier is later valued — same treatment as any
// other item with no fully-trustworthy source. See `buildFairPriceMap` for why that bootstrap has
// to be a throwaway, separate from the real solve, rather than just settling currencies as part
// of one combined pass.

// Wraps a plain `{itemId: price}` Map as a minimal market-like object, so the existing
// `getUnitCost`/`mergedContentsOf` helpers can consume a fair-price snapshot exactly like a
// real `createMarket()` market, without needing a second, parallel set of helpers.
function priceMapAsMarket(priceMap) {
    return {
        peekUnitCost: (itemId) => {
            const v = priceMap.get(itemId);
            return Number.isFinite(v) ? v : NaN;
        },
    };
}

const ALLIANCE_CHEST_ID_PATTERN = /^lv\d+_alliance_chest$/;

// Items excluded from `regressionFill`'s variable set entirely — see that function's header for
// why including them makes the fit worse, not better.
function isFillerItem(itemId) {
    return itemId === 'diamonds' || itemId === 'vip_points' || ALLIANCE_CHEST_ID_PATTERN.test(itemId);
}

// Turns a bundle's contents into one regression row: filler items are dropped outright, and
// anything already `settled` is folded into the target instead of kept as a variable, so the row
// only ever asks the solve to explain the LEFTOVER price with whatever's still unresolved.
// Returns null if nothing in the bundle is still unresolved (nothing for this row to contribute).
function buildRegressionRow(contentsMap, price, settled) {
    let knownValue = 0;
    const coeffs = new Map();
    for (const [itemId, qty] of contentsMap) {
        if (isFillerItem(itemId)) {
            continue;
        }
        if (settled.has(itemId)) {
            knownValue += qty * settled.get(itemId);
        } else {
            coeffs.set(itemId, (coeffs.get(itemId) || 0) + qty);
        }
    }
    if (coeffs.size === 0) {
        return null;
    }
    return { coeffs, target: price - knownValue };
}

/**
 * Solves `rows` (each `{ coeffs: Map<itemId, quantity>, target: banknotes }`, read as
 * "sum(quantity * price) ≈ target") for a non-negative price per item, via ridge-regularized
 * least squares: closed-form (a single linear solve, not an iterative search), so — unlike a
 * textbook NNLS solver, which was tried here first — it can never hang or fail to converge on
 * this dataset's rank-deficient bundles (several items are only ever bundled in exact lockstep
 * with a sibling, e.g. some tiers of the grain/timber-level resources, which makes some columns
 * exact linear combinations of others). The `+ λI` regularization term is what makes that
 * solvable at all. A negative result is dropped (left unsettled) rather than clamped to zero and
 * kept, since a negative result here means the evidence didn't actually support a positive price
 * for that item.
 */
function solveNonNegativeLeastSquares(rows) {
    const itemIds = [...new Set(rows.flatMap((row) => [...row.coeffs.keys()]))];
    if (itemIds.length === 0) {
        return new Map();
    }
    const colIndex = new Map(itemIds.map((id, i) => [id, i]));

    const X = new Matrix(
        rows.map((row) => {
            const line = new Array(itemIds.length).fill(0);
            for (const [id, coeff] of row.coeffs) {
                line[colIndex.get(id)] = coeff;
            }
            return line;
        }),
    );
    const y = Matrix.columnVector(rows.map((row) => row.target));

    // Column-normalize before solving: item quantities span from 1 to hundreds of thousands in
    // this dataset, and that spread alone is enough to make the regularized system numerically
    // unstable without it. Undone on the result below.
    const scales = [];
    for (let col = 0; col < X.columns; col++) {
        const column = X.getColumn(col);
        const norm = Math.sqrt(column.reduce((sum, value) => sum + value * value, 0)) || 1;
        scales.push(norm);
        for (let row = 0; row < X.rows; row++) {
            X.set(row, col, X.get(row, col) / norm);
        }
    }

    const REGULARIZATION = 1e-6;
    const XtX = X.transpose().mmul(X);
    for (let i = 0; i < XtX.rows; i++) {
        XtX.set(i, i, XtX.get(i, i) + REGULARIZATION);
    }
    const Xty = X.transpose().mmul(y);
    const beta = solveLinearSystem(XtX, Xty).to1DArray();

    const prices = new Map();
    itemIds.forEach((id, i) => {
        const price = beta[i] / scales[i];
        if (price > 0) {
            prices.set(id, price);
        }
    });
    return prices;
}

/**
 * Computes a bundle-aware "fair" per-item price snapshot via the two-tier solve described above.
 * `exclude` (optional `{ packageId }` or `{ shopId, thresholdStr }`) drops one specific bundle
 * from participating at all (it's simply never added to `bundles` below) — a self-reference
 * guard, since a bundle is never allowed to count as evidence for its own worth. Pass `null` for
 * a shared, nothing-excluded snapshot (e.g. for exchange offers, which never self-reference
 * anything). `excludeWeeklyPasses` (default `true`) controls whether `category: "weekly_pass"`
 * packages are allowed to be a pricing source at all — see the module header for why they
 * default to excluded.
 */
function buildFairPriceMap(packages, exchangeShops, items, locale, exclude = null, excludeWeeklyPasses = true) {
    // Every candidate bundle the real-money packages can offer: `{ price, contents: Map<itemId,
    // qty>, kind: 'package' }`. Built once and reused both for the currency bootstrap below and
    // the real solve, since self-exclusion (`exclude`) never needs to differ between the two.
    const packageBundles = [];

    for (const [pkgId, pkg] of Object.entries(packages)) {
        if (
            exclude?.packageId === pkgId ||
            pkg.choice ||
            !pkg.contains ||
            (excludeWeeklyPasses && pkg.category === 'weekly_pass')
        ) {
            continue;
        }
        if (!Number.isFinite(pkg.price) || pkg.price <= 0) {
            continue;
        }
        packageBundles.push({ price: pkg.price, contents: new Map(Object.entries(pkg.contains)), kind: 'package' });
    }

    // Runs the strict Dijkstra solve against `bundles`/`settled` to full exhaustion, using ONLY
    // genuine, bundle-derived candidates, never the regression fallback below. A bundle offers a
    // candidate for its one remaining unsettled item once every OTHER item it contains is
    // settled; a non-positive residual means that bundle is uninformative for that item (not
    // "free" — see module header) and simply offers nothing.
    //
    // Candidates come in two trust tiers, tracked separately each round: `kind: 'exchange'`
    // bundles are always exactly one item with no residual involved (an offer only ever declares
    // one item type) — a DIRECT, posted market rate. `kind: 'package'` candidates are a
    // RESIDUAL — an inference from "whatever's left after this bundle's other, already-priced
    // contents" — which is only as reliable as the assumption that the bundle isn't specifically
    // discounting or padding that one component. When both exist for the same item in the same
    // round, the direct rate wins outright, even if numerically more expensive: a residual can be
    // skewed arbitrarily low by a single generous promotional bundle (found in practice — a
    // themed weekly pass priced as "diamonds plus an essentially-free bonus" made that bonus item
    // look ~10,000x cheaper than its own posted exchange-shop rate). Within the same tier,
    // cheapest still wins, same as before. This is safe to call repeatedly as `settled` grows:
    // recomputes pending counts from scratch each time rather than relying on incremental
    // bookkeeping, so there's no risk of missing a bundle that only became fireable because of a
    // just-added price — and no risk of the reverse, either: since every `kind: 'exchange'`
    // bundle's price is already a known constant by the time this ever runs (see the currency
    // bootstrap below), a direct candidate for a given item is available from the very first
    // round it's reachable at all, so it can never lose a race to a residual candidate that only
    // becomes fireable in some later round — the tie-breaking below only has to matter for
    // candidates that both show up in the very same round.
    function exhaustGenuineSettlements(bundles, settled) {
        let progress = true;
        while (progress) {
            progress = false;
            const directFrontier = new Map();
            const residualFrontier = new Map();

            for (const { price: bundlePrice, contents, kind } of bundles) {
                let otherValue = 0;
                let remainingItemId = null;
                let remainingQty = 0;
                let unsettledCount = 0;
                for (const [itemId, qty] of contents) {
                    if (settled.has(itemId)) {
                        otherValue += qty * settled.get(itemId);
                    } else {
                        unsettledCount++;
                        remainingItemId = itemId;
                        remainingQty = qty;
                    }
                }
                if (unsettledCount !== 1 || remainingQty <= 0) {
                    continue;
                }
                const residual = bundlePrice - otherValue;
                if (residual <= 0) {
                    continue;
                }
                const candidate = residual / remainingQty;
                const frontier = kind === 'exchange' ? directFrontier : residualFrontier;
                if (candidate < (frontier.get(remainingItemId) ?? Infinity)) {
                    frontier.set(remainingItemId, candidate);
                }
            }

            for (const itemId of directFrontier.keys()) {
                residualFrontier.delete(itemId);
            }
            const frontier = new Map([...residualFrontier, ...directFrontier]);

            while (frontier.size > 0) {
                let bestItemId = null;
                let bestPrice = Infinity;
                for (const [itemId, candidatePrice] of frontier) {
                    if (candidatePrice < bestPrice) {
                        bestPrice = candidatePrice;
                        bestItemId = itemId;
                    }
                }
                frontier.delete(bestItemId);
                settled.set(bestItemId, bestPrice);
                progress = true;
            }
        }
    }

    // A shop's currency needs a price before its offers/bonus tiers can become candidate bundles
    // at all (an offer's own bundle price is `currency_cost * currencyUnitCost`). That price has
    // to be trustworthy: crediting a whole sibling package's price to the currency alone
    // reintroduces the exact distortion this algorithm exists to avoid, so only a GENUINE
    // settlement counts — never a regression estimate. Solved here as a throwaway, package-only
    // pass, entirely separate from the real `settled` map below: this determines WHICH currencies
    // are usable and at what price, but none of ITS other (non-currency) settlements are allowed
    // to leak into the real solve — otherwise an item could settle prematurely here, from
    // packages alone, before a same-quality-or-better exchange-offer candidate for that same item
    // even exists to compete (an earlier version of this function had exactly that bug: raven
    // essence settled off a single generous weekly pass before a direct VIP-shop exchange rate —
    // 10,000x higher — ever got a chance to weigh in). Building the FULL bundle list up front,
    // below, and only then running the real solve once is what avoids that ordering trap.
    const currencyPrices = new Map();
    {
        const bootstrapSettled = new Map();
        exhaustGenuineSettlements(packageBundles, bootstrapSettled);
        for (const shop of Object.values(exchangeShops)) {
            if (bootstrapSettled.has(shop.currency_item_id)) {
                currencyPrices.set(shop.currency_item_id, bootstrapSettled.get(shop.currency_item_id));
            }
        }
    }

    // The full candidate bundle list this solve draws on: every package above, plus every
    // offer/bonus tier from a shop whose currency the bootstrap above could genuinely price. A
    // currency the bootstrap couldn't settle is left out of the solve entirely rather than
    // trusted — items only reachable through such a shop simply stay unsettled here and correctly
    // fall through to `valueOfBundle`'s existing "exclusive item" residual-split when their own
    // package/bonus-tier is later valued, same treatment as any other item with no
    // fully-trustworthy source. `kind` distinguishes real-money package purchases from
    // exchange-derived ones: it drives the trust-tiering in `exhaustGenuineSettlements` above,
    // and only `'package'` bundles feed `regressionFill` below (see its header for why).
    const bundles = [...packageBundles];
    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        const currencyUnitCost = currencyPrices.get(shop.currency_item_id);
        if (!Number.isFinite(currencyUnitCost)) {
            continue;
        }

        for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
            const offerItemId = offer.item_id || offerKey;
            const offerPrice = offer.currency_cost * currencyUnitCost;
            if (!Number.isFinite(offerPrice) || offerPrice <= 0 || !(offer.quantity > 0)) {
                continue;
            }
            bundles.push({ price: offerPrice, contents: new Map([[offerItemId, offer.quantity]]), kind: 'exchange' });
        }

        for (const [thresholdStr, contains] of Object.entries(shop.bonus_tiers || {})) {
            if (exclude?.shopId === shopId && exclude.thresholdStr === thresholdStr) {
                continue;
            }
            const bundlePrice = Number(thresholdStr) * currencyUnitCost;
            if (!Number.isFinite(bundlePrice) || bundlePrice <= 0) {
                continue;
            }
            bundles.push({ price: bundlePrice, contents: new Map(Object.entries(contains)), kind: 'exchange' });
        }
    }

    const settled = new Map();

    // Anything still unsettled after `exhaustGenuineSettlements` is permanently stuck: no bundle
    // containing it can EVER reach "exactly one unsettled item" without outside help, because at
    // least one of its bundle-mates is ALSO stuck (this dataset leans heavily on multi-item
    // bundles with no clean single-item anchor even for near-universal items like diamonds, so
    // that's common, not a rare edge case). Left alone, this is what made every package
    // containing such an item show value_ratio 1.0000 — `valueOfBundle`'s residual-split
    // swallows the bundle's ENTIRE price the moment even one content item has no price at all.
    //
    // Rather than crediting one bundle's WHOLE price to one stuck item at a time (a per-item
    // naive credit was tried here and rejected — it reproduces the exact "one bundle's entire
    // price dumped on one item" distortion this whole algorithm exists to avoid, just for items
    // this first tier couldn't reach), every still-stuck item is priced JOINTLY: one linear
    // "quantity * price ≈ paid amount" equation per real-money package still containing an
    // unsettled item (its price with every ALREADY-known item's contribution subtracted out —
    // see `buildRegressionRow`), plus an exact equality per item that's just a fixed wrapper
    // around another (e.g. "herb_level_supply_ur = 2,603,150 herbs"), solved all at once via
    // regularized non-negative least squares (`solveNonNegativeLeastSquares`). An item's price
    // this way reflects the total weight of evidence across EVERY bundle it appears in, not
    // whichever single bundle happened to get to it first.
    //
    // Items with no independent price of their own no matter how the rest of the graph settles —
    // "diamonds", "vip_points", and alliance chests, all of which are bundled into nearly every
    // package alongside whatever ELSE that package is actually selling — are deliberately left
    // out of the regression entirely (`isFillerItem`), rather than treated as unknowns to solve
    // for. Including them was tried and made the fit WORSE, not better: because they appear in
    // huge, uneven quantities across nearly every bundle, an unconstrained least-squares solve
    // finds it "cheapest" (in a total-error sense) to explain most of the dataset by adjusting
    // just those two or three variables and leaving everything else at zero. Excluding them
    // removes that escape hatch and forces the fit to actually use each bundle's OTHER contents.
    //
    // Exchange offers/bonus tiers are excluded from the regression too (`bundle.kind !==
    // 'package'` below), even ones whose currency settled genuinely: an offer's own "price" is
    // already one inferential step removed from a real transaction (it depends on a currency's
    // price, which is itself an estimate elsewhere in this same system), and including them was
    // found empirically to reintroduce the same kind of distortion — a small amount of weight on
    // a shaky variable was enough to pull otherwise well-evidenced items back down to zero. They
    // still get valued normally (via `valueOfBundle`) against whatever this produces, same as any
    // other bundle; they just don't get to shape anyone ELSE's price.
    // `type: "choice"` items (e.g. "Resource Supply (UR)": pick 1 of grain/timber/herb level
    // supply) are deliberately skipped by `regressionFill`'s identity rows above — "price =
    // whichever option is worth the most" isn't a linear equality a least-squares solve can
    // express — so without this they'd never get a price of their own at all, and would fall
    // through to `valueOfBundle`'s "exclusive item" residual split for every package that
    // contains them. That split can come out as exactly 0 whenever a bundle's OTHER contents
    // already account for its entire price (as happened for Development Pack's own Resource
    // Supply (UR), even though every one of its possible contents — grain/timber/herb — has a
    // perfectly good price by this point), which reads as "this item is worthless" rather than
    // "we didn't bother pricing it."
    //
    // Run after `regressionFill` (needs its output: the choice's own options are typically only
    // priced via the joint regression, same as any other non-anchored item) and looped to a
    // fixed point so a choice-of-choices chain resolves in as many passes as it needs: an item
    // only settles once at least one of its options has every one of ITS contents already
    // priced, then contributes a price to whatever depends on IT in turn. Matches the same
    // "assume the optimistic best option" convention `mergedContentsOf` already uses for a
    // PACKAGE's own choice block — the difference here is only that this prices the choice
    // ITEM's own market value (for when it shows up as an ordinary `{itemId: qty}` entry inside
    // some OTHER bundle's `contains`), not a specific package's pick from it.
    function resolveChoiceContainerItems() {
        let progress = true;
        while (progress) {
            progress = false;
            for (const [itemId, item] of Object.entries(items)) {
                if (settled.has(itemId) || item.type !== 'choice' || !item.choice?.choices?.length) {
                    continue;
                }
                let best = null;
                for (const choiceEntry of item.choice.choices) {
                    let total = 0;
                    let allKnown = true;
                    for (const [subId, qty] of Object.entries(choiceEntry)) {
                        const subPrice = settled.get(subId);
                        if (!Number.isFinite(subPrice)) {
                            allKnown = false;
                            break;
                        }
                        total += qty * subPrice;
                    }
                    if (allKnown && (best === null || total > best)) {
                        best = total;
                    }
                }
                if (best !== null) {
                    settled.set(itemId, best);
                    progress = true;
                }
            }
        }
    }

    function regressionFill() {
        const rows = [];

        for (const bundle of bundles) {
            if (bundle.kind !== 'package') {
                continue;
            }
            const row = buildRegressionRow(bundle.contents, bundle.price, settled);
            if (row) {
                rows.push(row);
            }
        }

        for (const [itemId, item] of Object.entries(items)) {
            if (!item.contains || item.type === 'choice' || item.type === 'random' || isFillerItem(itemId)) {
                continue;
            }
            const identity = new Map([
                [itemId, 1],
                ...Object.entries(item.contains).map(([subId, qty]) => [subId, -qty]),
            ]);
            const row = buildRegressionRow(identity, 0, settled);
            if (row) {
                rows.push(row);
            }
        }

        if (rows.length === 0) {
            return;
        }

        for (const [itemId, price] of solveNonNegativeLeastSquares(rows)) {
            settled.set(itemId, price);
        }
    }

    exhaustGenuineSettlements(bundles, settled);
    regressionFill();
    resolveChoiceContainerItems();

    return settled;
}

function rankPackages(packages, fairPricingExchangeShops, items, locale, excludeItemIds, excludeWeeklyPasses) {
    const rankings = [];

    for (const [pkgId, pkg] of Object.entries(packages)) {
        const price = pkg.price;
        if (!Number.isFinite(price) || price <= 0) {
            continue;
        }

        const excludingMarket = priceMapAsMarket(
            buildFairPriceMap(
                packages,
                fairPricingExchangeShops,
                items,
                locale,
                { packageId: pkgId },
                excludeWeeklyPasses,
            ),
        );
        const merged = mergedContentsOf(pkg, excludingMarket);
        const { total, complete, breakdown } = valueOfBundle(
            merged,
            price,
            excludingMarket,
            items,
            locale,
            excludeItemIds,
        );

        rankings.push({
            type: 'package',
            id: pkgId,
            name: packageDisplayName(pkg, locale),
            category: pkg.category || '-',
            price,
            price_display: t('rankings.priceDisplay.package', {
                price: formatThousands(price),
                currency: t('currency.banknotes'),
            }),
            total_value: Number(total.toFixed(2)),
            value_ratio: Number((total / price).toFixed(4)),
            purchase_limit: pkg.purchase_limit,
            limit_type: pkg.limit_type,
            available_days: pkg.available_days || null,
            requires: pkg.requires || null,
            value_complete: complete,
            contains_breakdown: breakdown,
        });
    }

    return rankings;
}

function rankExchangeOffers(exchangeShops, market, currencyMarket, items, locale, excludeItemIds) {
    const rankings = [];

    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        const currencyUnitCost = getUnitCost(currencyMarket, shop.currency_item_id);

        for (const [offerKey, offer] of Object.entries(shop.offers || {})) {
            const offerItemId = offer.item_id || offerKey;
            const isExcluded = excludeItemIds?.has(offerItemId) ?? false;
            // No self-exclusion here: an offer only ever hands over one declared item type, so
            // there's no bundling ambiguity to game — see module header.
            const unitCost = getUnitCost(market, offerItemId);

            const totalValue = isExcluded ? 0 : offer.quantity * (unitCost ?? 0);
            const price = offer.currency_cost * (currencyUnitCost ?? NaN);
            if (!Number.isFinite(price) || price <= 0) {
                continue;
            }

            const currencyName = localizedName(items[shop.currency_item_id]?.name, locale) || shop.currency_item_id;

            rankings.push({
                type: 'exchange_offer',
                id: `${shopId}:${offerKey}`,
                name: `${localizedName(shop.name, locale)} - ${localizedName(items[offerItemId]?.name, locale) || offerItemId}`,
                category: shop.category || (shop.event_id ? 'event_exchange' : 'exchange'),
                price: Number(price.toFixed(6)),
                price_display: t('rankings.priceDisplay.exchange', {
                    cost: formatThousands(offer.currency_cost),
                    currencyName,
                    approx: formatThousands(Number(price.toFixed(2))),
                    currency: t('currency.banknotes'),
                }),
                total_value: Number(totalValue.toFixed(2)),
                value_ratio: Number((totalValue / price).toFixed(4)),
                purchase_limit: offer.purchase_limit,
                limit_type: offer.limit_type,
                available_days: null,
                requires: null,
                value_complete: (isExcluded || unitCost !== null) && currencyUnitCost !== null,
                contains_breakdown: [
                    {
                        item_id: offerItemId,
                        name: localizedName(items[offerItemId]?.name, locale) || offerItemId,
                        quantity: offer.quantity,
                        unit_cost: unitCost,
                        value: isExcluded ? 0 : unitCost !== null ? Number(totalValue.toFixed(6)) : 0,
                        known: isExcluded || unitCost !== null,
                    },
                ],
            });
        }
    }

    return rankings;
}

function rankBonusTiers(
    packages,
    exchangeShops,
    fairPricingExchangeShops,
    currencyMarket,
    items,
    locale,
    excludeItemIds,
    excludeWeeklyPasses,
) {
    const rankings = [];

    for (const [shopId, shop] of Object.entries(exchangeShops)) {
        const currencyUnitCost = getUnitCost(currencyMarket, shop.currency_item_id);

        for (const [thresholdStr, contains] of Object.entries(shop.bonus_tiers || {})) {
            const threshold = Number(thresholdStr);
            if (!Number.isFinite(threshold) || threshold <= 0) {
                continue;
            }

            const price = threshold * (currencyUnitCost ?? NaN);
            if (!Number.isFinite(price) || price <= 0) {
                continue;
            }

            const excludingMarket = priceMapAsMarket(
                buildFairPriceMap(
                    packages,
                    fairPricingExchangeShops,
                    items,
                    locale,
                    { shopId, thresholdStr },
                    excludeWeeklyPasses,
                ),
            );
            const { total, complete, breakdown } = valueOfBundle(
                new Map(Object.entries(contains)),
                price,
                excludingMarket,
                items,
                locale,
                excludeItemIds,
            );

            const currencyName = localizedName(items[shop.currency_item_id]?.name, locale) || shop.currency_item_id;

            rankings.push({
                type: 'bonus_tier',
                id: `${shopId}:bonus_tier_${thresholdStr}`,
                name: `${localizedName(shop.name, locale)} - ${t('sourceType.bonus_tier')} (${thresholdStr} ${currencyName})`,
                category: shop.category || (shop.event_id ? 'event_exchange' : 'exchange'),
                price: Number(price.toFixed(6)),
                price_display: t('rankings.priceDisplay.bonusTier', {
                    threshold: formatThousands(threshold),
                    currencyName,
                    approx: formatThousands(Number(price.toFixed(2))),
                    currency: t('currency.banknotes'),
                }),
                total_value: Number(total.toFixed(2)),
                value_ratio: Number((total / price).toFixed(4)),
                purchase_limit: 1,
                limit_type: 'cumulative_spend',
                available_days: null,
                requires: null,
                value_complete: complete && currencyUnitCost !== null,
                contains_breakdown: breakdown,
            });
        }
    }

    return rankings;
}

/**
 * Builds the full live ranking of packages/exchange offers/bonus tiers from raw pack data.
 * Mirrors the shape of the (now retired) output/value_ranking.json for a drop-in swap.
 *
 * `options.excludeExchangeShops`, when true, drops exchange shops entirely: neither the price
 * market nor the value attribution consider exchange offers as a source (so package "value" is
 * computed from packages alone), and exchange offer / bonus tier entries — both inherently
 * shop-based — are left out of the rankings altogether rather than kept around with a
 * now-pointless price.
 *
 * `options.excludeItemIds`, when given, zeroes out those item ids' contribution to every
 * bundle's value/ratio computation (see `valueOfBundle`) — e.g. near-universal filler
 * currencies that would otherwise pad every package's value regardless of its actual unique
 * rewards. They still get their own `contains_breakdown` row (with `value: 0`, so the item
 * stays visible rather than silently vanishing from the breakdown) and are still priced
 * informationally wherever something else needs their cost (e.g. a shop's currency); only their
 * contribution to the bundle's own total is suppressed.
 *
 * `options.excludeWeeklyPasses` (default `true`) controls whether `category: "weekly_pass"`
 * packages are trusted as pricing SOURCES for other items — see `buildFairPriceMap`'s header for
 * why they're untrustworthy by default. Turning this off doesn't remove the passes from the
 * rankings themselves (they're always valued and listed); it only lets their contents count as
 * evidence when pricing everything else too.
 *
 * Every package/bonus-tier's own contents are priced via `buildFairPriceMap` (see that
 * function's header), not pricing-core.js's naive per-item market. That solve always draws on
 * the FULL exchange-shop data as pricing evidence regardless of `excludeExchangeShops`, even
 * though excluded shops' own offers/bonus tiers still won't appear as their own ranked rows —
 * unlike a naive per-item market (which always finds SOME package-only price for nearly
 * anything), the fair solve needs a bundle's every OTHER item to be fully settled before it can
 * price the last one, so a sparser graph with exchange shops removed leaves most items unable
 * to settle at all; since ANY unsettled item in a bundle makes `valueOfBundle`'s residual-split
 * force that bundle's total to exactly equal its price, a sparser graph would otherwise turn
 * into every single package showing value_ratio 1.0000.
 */
function buildRanking(data, locale = 'en', options = {}) {
    const { excludeExchangeShops = false, excludeItemIds = null, excludeWeeklyPasses = true } = options;
    const items = data.items || {};
    const packages = data.packages || {};
    const exchangeShops = excludeExchangeShops ? {} : data.exchange_shops || {};
    const fairPricingExchangeShops = data.exchange_shops || {};
    // Shop currencies are always converted via the plain (naive) market — a currency that's
    // itself only sold as part of a multi-item bundle can otherwise fail to settle under the
    // stricter fair-pricing solve (see `buildFairPriceMap`'s header), which would wipe out every
    // offer/bonus tier priced in that currency rather than just making their VALUE fair. Only
    // what a bundle/offer *hands you* gets fair pricing.
    const currencyMarket = createMarket(packages, exchangeShops, items, {}, {}, locale);
    const market = priceMapAsMarket(
        buildFairPriceMap(packages, fairPricingExchangeShops, items, locale, null, excludeWeeklyPasses),
    );

    const rankings = [
        ...rankPackages(packages, fairPricingExchangeShops, items, locale, excludeItemIds, excludeWeeklyPasses),
        ...rankExchangeOffers(exchangeShops, market, currencyMarket, items, locale, excludeItemIds),
        ...rankBonusTiers(
            packages,
            exchangeShops,
            fairPricingExchangeShops,
            currencyMarket,
            items,
            locale,
            excludeItemIds,
            excludeWeeklyPasses,
        ),
    ]
        .filter((entry) => Number.isFinite(entry.value_ratio))
        .sort((a, b) => b.value_ratio - a.value_ratio)
        .map((entry, index) => ({ rank: index + 1, ...entry }));

    return {
        metadata: {
            generated_at: new Date().toISOString(),
            source_last_updated: data.metadata?.last_updated || null,
            currency: data.metadata?.currency || t('currency.banknotes'),
            entry_count: rankings.length,
            note: t('rankings.note'),
        },
        rankings,
    };
}

/**
 * Exposes the same bundle-aware "fair" per-item pricing `buildRanking` uses to value a
 * package/bonus-tier's own contents (see module header) as a standalone market-like object
 * (`{ peekUnitCost(itemId) }`), for callers that want a single item's fair Banknotes value
 * without going through the full package/offer ranking (e.g. the item-vs-item Compare page).
 * Always draws on the full exchange-shop data as pricing evidence, same as `buildRanking`.
 */
function createFairValueMarket(data, locale = 'en', options = {}) {
    const { excludeWeeklyPasses = true } = options;
    const items = data.items || {};
    const packages = data.packages || {};
    const exchangeShops = data.exchange_shops || {};
    return priceMapAsMarket(buildFairPriceMap(packages, exchangeShops, items, locale, null, excludeWeeklyPasses));
}

export { buildRanking, createFairValueMarket };
