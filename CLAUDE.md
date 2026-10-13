# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Last Asylum Pack Solver

A static webapp that values items, packages and exchange-shop offers from `data/pack_data.json` (mobile game
"Last Asylum: Plague"), computed live in the browser, deployed to GitHub Pages.

## Scope Discipline

- Prefer the smallest change that solves the stated problem. Do not add new schema sections, sync scripts, npm
  commands, or lint-staged wiring unless asked.
- If you think a larger refactor is warranted, describe it in one paragraph and wait for approval before editing
  files.
- When the user proposes a data-structure design, implement it as described. Raise concerns once, then defer to
  the user's decision.

## Git Safety

- NEVER create branches, push to remote, or open PRs unless explicitly asked. Work on the current branch and stop
  after committing locally.
- Never downgrade dependency or GitHub Action versions to "fix" a problem. If a version looks wrong, ask first.

## Commands

```bash
npm run verify-data                                          # validate data/pack_data.json (schema, references, item worth)
npm run lint                                                  # eslint .
npm run webapp:dev                                             # copy-pack-data + vite dev server
npm run webapp:build                                           # copy-pack-data + vite build -> webapp/dist
npm run i18n:missing -- [lang] [--keys-only] [--data-only]     # missing translations (UI texts + data names)
npm run record-run -- <ids...> [START] <DAYS> | --show [ids]  # record when events / passes / tracks run
```

`schedule` in `pack_data.json` records per event, seasonal pass family and spend reward track its runs as
inclusive `{ start, end }` dates (`record-run` computes the end from the start and the number of days). Events with
`"category": "ingame_event"` have no packs or shop and are only tracked there (not offered under "Events this
week"). The Home page shows it as a timeline (last week, this week, 4 ahead) with a simple forecast
(`lib/schedule.js`: ids with at least two runs repeat their median gap between starts and median length).

No test suite exists in this repo.

## Valuation Model

Every item has a worth in **points** (a relative scale; diamonds = 1, as the in-game deal % counts them). Nothing
is stored in `pack_data.json`: `point-fit.js` fits the "leaf" items live from every pack's deal % (robust log-space
least squares, shop offers as weak extra equations, data-derived ties), and everything else is derived from its
structure (`contains` = sum, random `drop_table` = expected value, `choice` = best options, `substitutes_for` =
best target, `value_equivalent` = sum of the listed items, `reversible` crafting chains propagate one value both
ways, `crafted_from` recipes cap an item at its ingredients and weakly tie it to them). `fitSensitivity` (leave one
pack family out) flags values that hinge on one pack. The user's item priorities (`settings.js`: Don't care / Low /
Normal / High = 0 / 50 / 100 / 150 %) multiply values after the fit (`weights` in `item-values.js`); VIP points,
alliance chests, ... start at Don't care — they stay in the fit (the deal % counts them). Moon Coins and Star Moon
Sigils are deliberately unmodelled (`UNMODELLED_ITEMS`). Currencies (diamonds, event coins)
have no points of their own — they're worth only what their shop offers buy.

There is ONE model (`valuation.js`): the weekly-budget MILP/LP (`planner.js`, HiGHS) maximizing points under
purchase limits at the user's weekly spend; worth = points ÷ the marginal points per Banknote, currencies at their
shadow value. Spend Rewards re-solves it per tier total. Compare uses `acquire.js` (`solveNeeds`): an exact
minimum-cost MILP over every conversion (open/pick/substitute/craft/exchange), weekday-aware (weekly limits reset on
Monday, `delivery_days`), with `exclusive_group`s and random chests counting only what they guarantee. A package
with `bundles` (the Weekly Pass, which includes the single weekly passes) is never bought together with the packages
it bundles, in both models. Shop progress points (`points_per_currency` per coin spent + `point_purchase`, e.g. the
Surprise Encounter's Encounter Points) gate `bonus_tiers` and offer `unlock_points` in the weekly plan only (not in
Compare). The Ranking shows only Banknote purchases; the Events page shows an event's slice of the same plan (packs,
coins, shop offers) plus what-if steps (`eventSpend` option of the planner); optional extra Banknotes only for the
selected event (`eventBudget`) and extra VIP Shop diamonds (`extraCurrency`) change only that page's plan. Locks
on shop offers (`lockedOffers` in the settings, set on the Events page) fix an exact count per week (0 = never) in
the ONE plan on every page; if the spend can't cover them, the plan first buys as many as possible (reported in
`lockShortfalls`) and then plans the rest around them.

## Project Structure

```
data/pack_data.json               # source of truth, schema-validated by data/pack_data.schema.json
webapp/src/lib/catalog.js         # tier expansion + purchase-capacity rules (per week / per horizon)
webapp/src/lib/point-fit.js       # base points fitted live from deal % (+ leave-one-out sensitivity)
webapp/src/lib/item-values.js     # points resolution (base points + structure)
webapp/src/lib/planner.js         # the worth model (weekly budget LP)
webapp/src/lib/acquire.js         # cheapest plan for a set of needs (Compare)
webapp/src/lib/spend-tracks.js    # spend reward tracks (tier costs, track points per purchase)
webapp/src/lib/item-sources.js    # units of one item a purchase gives, nested (Item Sources page)
webapp/src/lib/schedule.js        # recorded schedule as runs per id + simple forecast (Home timeline)
webapp/src/lib/lp.js              # HiGHS wrapper (LP text builder, duals); highs-browser.js locates the .wasm
webapp/src/lib/valuation.js       # the one worth interface for the pages
webapp/src/lib/valuation-panel.js # shared controls (weekly spend, events, tracks)
webapp/src/lib/settings.js        # localStorage settings incl. item priorities (Don't care/Low/Normal/High)
webapp/src/i18n/{en,de}.json      # UI texts; de.json is translated and kept in sync with en.json
```

The pure modules (`catalog`, `point-fit`, `item-values`, `planner`, `acquire`, `lp`, `spend-tracks`,
`item-sources`, `schedule`) have no DOM/i18n dependency and use explicit `.js` import extensions, so Node scripts
(`scripts/verify-data.js`) can import them. Keep it that way.

## Conventions

- `data/pack_data.json` is auto-processed on commit (husky + lint-staged): sort → update-last-updated → prettier.
- Don't hardcode item points in `pack_data.json`; worth comes from the deal % fit and the user's priorities. Fix a
  bad value with better data (contents, deal %, `crafted_from`, `value_equivalent`, ...).
- Any change, addition or removal in `webapp/src/i18n/en.json` must be mirrored in `de.json` in the same change
  (translate it yourself; same keys and order, `{placeholders}` unchanged).
- Never translate `name.de` in `data/pack_data.json` yourself: those are taken manually from the game, not guessed.
  Leave them blank (`npm run i18n:missing` lists them).

## Formatting Conventions

- Numbers in tables: thousand separators, right-aligned, consistent decimal padding.
- Item/package names on ranking pages include the tier suffix.

## Reference Documents

- `README.md` — webapp pages, valuation model, GitHub Pages deployment.
- `data/pack_data.schema.json` — full shape of `pack_data.json`.
