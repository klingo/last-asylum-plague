# Valuation rework: review of the uncommitted changes + replacing hardcoded `value` points

> Written 2026-10-03 after a lost agent session. The original plan of that session still exists at
> `C:\Users\Fabian\.claude\plans\in-this-webapp-there-fluffy-hamster.md` (2026-09-30), and its last chat
> fragment is in the untracked `2026-10-01-235853-1-yes-these-amounts-are-right-and-yes-the-depe.txt`.
> After approval, a copy of this file goes to `docs/valuation-rework-plan.md` in the repo (uncommitted).

## Context

### Why the rework was done
Before this, worth came from a stack of heuristic patches: `pricing-core.js`, `ranking-core.js` and
`purchase-plan.js`, plus a CommonJS CLI copy in `scripts/lib/pricing.js` that had to be kept in sync by
hand. Every page used a different variant, and the numbers couldn't be explained. The lost session
found three root causes:

1. **Joint-cost problem.** "Price ÷ yield" charges a pack's whole price to each single item, so every
   multi-item pack is over-valued. All later layers were patches on top of that.
2. **Diamonds ≈ price.** Almost every pack gives about 1 diamond per Banknote. If diamonds are worth what
   they cost, everything else in a pack is free. So a common value scale has to come from somewhere else.
3. **Game price signals disagree.** VIP-shop and event-shop rates differ by up to 5×. The in-game
   **deal %**, though, is internally consistent: a linear fit over the packs reproduces it closely.

### The idea behind it
Every item gets a worth in **points**, a relative scale where 1 point is about what deal % counts one
diamond as. Points only rank items against each other. They are turned into Banknotes in two ways:

- **Simple** (`worth-simple.js`): points ÷ R, where R is the median points per Banknote of the regular
  packs.
- **Accurate** (`planner.js`): a weekly-budget MILP/LP (HiGHS WASM). Worth = points ÷ λ, the marginal
  points per Banknote at your budget. Diamonds and event coins get their shadow values: they are worth
  only what their shops still buy (the VIP shop for diamonds).
- **Analyze** (`acquire.js`): an exact minimum-cost MILP covering open/pick/substitute/craft/exchange.

### What the uncommitted change contains (state: phases 1–4 of the old plan are done)
- **Data** (`pack_data.json`):
  - fixes: development_pack T2 diamonds, weekly_special T2 price, Moon Coin pack names and VIP points;
  - `purchase_limit: 1` on the weekly passes;
  - random contents for `lv5_raven_gear_chest` and `ur_epigraph_chest`;
  - `diamond_golden_egg` → 400 diamonds;
  - `value_equivalent` chains for the raven gear chests;
  - `reversible: true` on brass, leather, refined_iron and tempered_steel;
  - **58 hardcoded `value`s**, a one-off fit to deal % whose fit script was never committed (snapshot in
    the Appendix).
- **Schema**: `value` (`itemValue`) on all item kinds, `reversible`.
- **New pure modules**: `catalog`, `item-values`, `worth-simple`, `planner`, `acquire`, `lp`,
  `spend-tracks`.
- **New browser modules**: `highs-browser`, `valuation`, `valuation-panel`, `settings`, `labels`.
- **New pages**: Item Worth (`worth.html`) and Weekly Planner (`planner.html`).
- **Rewired pages**: Rankings, Choices, Analyze (`main.js`) and Spend Rewards.
- **Deleted**: Compare and Event Offers pages, the old cores, the CLI scripts and their npm scripts.
  `ml-matrix` was swapped for `highs`.
- **Updated**: verify-data (new worth check), README, CLAUDE.md and i18n, plus the memory file
  `project_valuation_model.md`.

### Problems found today
- `npm run verify-data` **crashes**. The cause is a typo at `data/pack_data.json:1476`
  (`"un``iversal_curio_shard"`), which makes `scripts/verify-data.js:412` read `items[id].name` of an
  unknown id.
- `npm run lint`: 0 errors, 31 warnings (mostly `no-console` in the page `init().catch`).
- The build was not run (plan mode).
- The lost session was paused at its **"review the points table" checkpoint**: an open question about
  UR curios / Red Amber Amulet (see the `.txt`).

### Your objection and decisions (2026-10-03)
- No hardcoded `value` in `pack_data.json`. **Points are fitted live in the browser from deal %**, and you
  can **override single items** on the Item Worth page (saved in localStorage).
- The worthless items (VIP points, Lv.1–6 alliance chests, Top-Up EXP, Stamina, Direct Relocate) become
  the **default "Ignored items"** setting instead of `value: 0`.

## Status (2026-10-03, implemented — not committed)
- Steps 0–4 are done:
  - `webapp/src/lib/point-fit.js` is written and wired into item-values, worth-simple, planner, valuation
    and verify-data;
  - the 58 `value`s and `itemValue` are removed from the data and schema;
  - the overrides UI is on Item Worth, and the default ignore list is in `settings.js` (merged once into
    existing browser settings via `version: 2`);
  - i18n, docs and memory are updated.
- Fit result: 49 values from 170 equations; packs match within 7.5% (median) and 21.6% (p90); about
  60 ms; deterministic. `npm run verify-data` prints the diagnostics.
- Uncertain values (override candidates): lv1_alliance_chest, r_epigraph, raven_evolve_guide, sr_epigraph,
  ssr_curio, survivor_token, and the UR/SSR gear pieces.
- Open points resolved:
  - Moon Coins, Star Moon Sigils and Surprise Emblems are skipped (`UNMODELLED_ITEMS`) and stay unknown;
  - UR Curio Chest stays one generic `ur_curio` (random curio, value falls with each duplicate), so the fit
    gives an average and you override it if needed.
- Noted: an override is pinned and the other items in the same pack rebalance. A pack's ratio therefore
  barely moves; the override changes how its value splits across items, not the pack's total.

## Proposed change: live deal % fit + user overrides

### Feasibility (prototyped today, not committed)
- A plain L1/LP fit **degenerates**: items appearing in only one pack go to 0 or explode.
- A **log-space least-squares fit** with data-derived ties, shop offers as weak signals and a weak ridge
  prior works:
  - median pack error is about 12%;
  - well-covered items land within ±40% of the curated values (gearstone 5.07 vs 4.88, study scroll 186
    vs 191, UR curio 19,800 vs 20,000, recruit ticket 764 vs 615, herbs/grain/timber ≈ equal);
  - weakly identified items drift: `ssr_curio`, `r_epigraph`, `sr_epigraph`, `survivor_token`,
    training/healing speedups, and the UR/SSR gear pieces behind `random_gear_chest`. Overrides are for
    exactly these.
- Weekly passes are outliers in deal % (×1.7–2.5), so the fit needs a robust loss.

### New pure module `webapp/src/lib/point-fit.js` (no DOM/i18n, explicit `.js` imports)
`fitItemPoints(data, { overrides = {} }) → { points: Map<itemId, {value, source: 'fit'|'override', support}>, diagnostics }`

1. **Parameters** are the "leaf" items: items with no derivable structure (no `contains`, `drop_table`,
   `choice` or `value_equivalent`). Ties come from the data (union-find):
   - single-target `substitutes_for` (omni shard = specific shard; matches the memory rule);
   - items sharing a uniform `drop_table` with equal single quantities (the 12 epigraph IV, the 6 lv5
     raven items).
   Structure expands into leaves the same way `item-values.js` resolves it: `contains` sums, random =
   expected value, `value_equivalent` sums, `reversible` chains via `contains`. A choice uses its best
   option, re-picked in 2–3 outer iterations, consistent with `bestChoices`.
2. **Scale**: `diamonds` is pinned at 1.
3. **Event coins** are fit parameters too, because they link shop-only items like `gear_blueprint_mr` and
   SR/SSR hero shards. Their fitted value is **discarded** afterwards: currency worth stays "what it buys",
   as today.
4. **Equations**:
   - every package with `deal_percentage`: `log(Σ q·v) ≈ log(price · deal% / 100)`. Tiers with identical
     contents per Banknote are deduplicated.
   - every exchange offer: `log(qty · v_item) ≈ log(cost · v_currency)` with a low weight (~0.2), because
     shop rates are noisy.
5. **Loss**: Huber on the log residual (δ ≈ 0.3) so that passes and outliers don't drag the fit, plus a
   weak ridge (~0.02) in log space toward a heuristic prior. The prior is the pack value left after
   diamonds, split evenly across the other lines, taking the median over packs. It only breaks ties for
   weakly identified items.
6. **Solver**: Levenberg–Marquardt with dense normal equations (~60 parameters, ~190 equations),
   written in plain JS. It's deterministic and takes milliseconds. No HiGHS is needed, so the simple model
   stays instant and verify-data works in Node.
7. **Overrides** are **pinned parameters** in the fit, so the other items in the same packs rebalance
   around them. **Ignored items stay free in the fit**, because deal % counts them (VIP points, for
   example). Pinning them to 0 would inflate everything packed with them. They are zeroed afterwards in
   `resolveItemValues`, as today.
8. **Diagnostics**:
   - median and p90 pack error, plus the worst packs;
   - per-item `support`: the number of equations it appears in. Support ≤ 1 marks a low-confidence value.

### Integration (reuse the existing code)
- `item-values.js`: `explicitValues()` reads a `basePoints` Map (fit merged with overrides) instead of
  `item.value`. Reversible lending downward stays. The source labels become `'fit'` / `'override'`
  instead of `'explicit'`.
- `worth-simple.js` (`computeSimpleWorth`), `planner.js` (`solveWeeklyPlan`) and `valuation.js`
  (`buildValuation`):
  - accept or pass `basePoints`;
  - `buildValuation` runs the fit once, memoized per data + overrides.
  - `acquire.js` is unchanged (it doesn't use points).
- `settings.js`:
  - new `pointOverrides: {}` setting, validated in `loadSettings`;
  - `DEFAULT_SETTINGS.ignoredItems` = the 10 worthless items. Your browser already stores
    `ignoredItems: []`, so reset once.
- Item Worth page (`worth.js`):
  - the points cell gets an override input, with "reset" back to the fitted value;
  - low-confidence values get a flag;
  - the summary shows fit quality.
  - The rest of the page is unchanged; overrides apply on every page through `buildValuation`.
- `scripts/verify-data.js`:
  - use the fit for the "Unknown/Partial Worth" check;
  - print the fit diagnostics (worst packs, low-support items);
  - guard `items[itemId]` against unknown ids.
- Data and schema:
  - delete the 58 `value` keys and the `itemValue` definition with its 3 `$ref`s;
  - keep `reversible` and all other data fixes.
- i18n:
  - `en.json`: `worth.source.fit` / `override`, the override UI strings and the low-confidence flag;
    rewrite `valuation.description` ("fitted live from the in-game deal %");
  - `de.json`: blank placeholders only.
- Docs and memory:
  - CLAUDE.md "Valuation Model" and "Conventions": drop "values are curated in pack_data.json" and
    document the fit, overrides and default ignores;
  - README "How worth is calculated";
  - update `project_valuation_model.md`.

### Open points for the review checkpoint
- `moon_coin` / `surprise_emblem` / `star_moon_sigil` were deliberately "unknown". The fit would now give
  them a deal %-implied value. Keep that, or exclude them?
- The open curio question from the lost session: should `curio_chest_ur` be generic (`ur_curio`) or a
  pick among specific UR curios? Red Amber Amulet has no value source.
- Which weakly identified items you want to override.

## Order of work
0. **Baseline**: fix the typo at `pack_data.json:1476` and the verify-data guard, so verify-data runs
   green (warnings only).
1. **`point-fit.js`** plus an ad-hoc Node comparison (not committed): fitted table vs. the Appendix
   snapshot, with fit diagnostics. **Checkpoint: you review the table and the open points.**
2. **Wire in**: item-values → worth-simple / planner / valuation / verify-data. Then remove `value` from
   data and schema.
3. **Settings**: overrides plus default ignore list; override UI on the Item Worth page.
4. **Wrap-up**: i18n, docs, memory; lint, build, verify; browser check.
5. **Re-run the old plan's verification** (planner/analyze sanity, browser pass), since it's unclear
   whether the lost session finished it.

No branches and no commits unless you ask. The leftover `.txt` transcript is yours: delete it or keep it.

## Verification
- `npm run verify-data` runs without errors and prints the fit diagnostics. The only unknown items are
  the deliberate ones.
- `npm run lint` shows no new warnings, and `npm run webapp:build` passes.
- Ad-hoc Node run:
  - the fit is deterministic (same output twice);
  - diamonds = 1;
  - median pack error ≤ ~15%;
  - pinning an override changes that item and rebalances its co-items;
  - ignoring VIP points zeroes them without changing the other fitted items;
  - R equals the median by construction;
  - at budgets of 5k/20k/100k the planner spends ≤ B and λ falls as the budget grows.
- Browser (`npm run webapp:dev` + claude-in-chrome):
  - Item Worth shows "Fitted"/"Override" sources;
  - an override persists across reloads and changes Rankings / Choices / Analyze;
  - reset restores the fitted value;
  - the default ignore list is pre-selected in a fresh profile;
  - every page loads with no dead nav links.

## Appendix: snapshot of the hardcoded values (removed from the data; reference for the review)
| Points | Items |
|---:|---|
| 61,400 | gear_blueprint_mr |
| 33,200 | each of the 12 epigraph IV items (frenzied_flock / guard_of_nature / protective_charm / reversal_power × ranger, warlock, warrior) |
| 22,300 | dragon_blood |
| 20,000 | ur_curio |
| 17,400 | twin_dragon_brooch |
| 14,800 | gear_blueprint_ur |
| 13,200 | random_gear_chest (overrode its drop table) |
| 9,580 | raven_evolve_guide |
| 5,260 | ssr_epigraph |
| 1,570 / 1,480 / 1,330 | ur_hero_shard / exclusive_weapon_shard / hero_awaken_shard |
| 762 / 679 | raven_essence / lv1_raven_gear_chest |
| 644 / 615 | survivor_recruit_ticket / recruit_ticket |
| 538 / 116 | ssr_hero_shard / sr_hero_shard |
| 207 / 206 | universal_curio_shard / ssr_curio |
| 191 | study_scroll |
| 118 | tempered_steel (reversible: lends down to refined_iron, brass, leather, cloth) |
| 113 / 63.8 / 48.9 | sr_epigraph / r_epigraph / ur_epigraph_shard |
| 82.7 | survivor_token |
| 10.7 / 7.65 | construction_speedup / research, training and healing speedup |
| 6.21 / 4.88 / 0.0554 | skill_badge / gearstone / raven_fruit |
| 0.000564 / 0.000379 / 0.000109 | herbs / grain and timber / antitoxin |
| 0 | vip_points, lv1–lv6_alliance_chest, top_up_exp, stamina, direct_relocate |
