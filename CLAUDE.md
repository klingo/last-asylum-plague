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
```

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
alliance chests, ... start at Don't care — they stay in the fit (the deal % counts them). Moon Coins, Star Moon
Sigils and Surprise Emblems are deliberately unmodelled (`UNMODELLED_ITEMS`). Currencies (diamonds, event coins)
have no points of their own — they're worth only what their shop offers buy.

There is ONE model (`valuation.js`): the weekly-budget MILP/LP (`planner.js`, HiGHS) maximizing points under
purchase limits at the user's weekly spend; worth = points ÷ the marginal points per Banknote, currencies at their
shadow value. Spend Rewards re-solves it per tier total. Compare uses `acquire.js` (`solveNeeds`): an exact
minimum-cost MILP over every conversion (open/pick/substitute/craft/exchange), weekday-aware (weekly limits reset on
Monday, `delivery_days`), with `exclusive_group`s and random chests counting only what they guarantee. A package
with `bundles` (the Weekly Pass, which includes the single weekly passes) is never bought together with the packages
it bundles, in both models.

## Project Structure

```
data/pack_data.json               # source of truth, schema-validated by data/pack_data.schema.json
webapp/src/lib/catalog.js         # tier expansion + purchase-capacity rules (per week / per horizon)
webapp/src/lib/point-fit.js       # base points fitted live from deal % (+ leave-one-out sensitivity)
webapp/src/lib/item-values.js     # points resolution (base points + structure)
webapp/src/lib/planner.js         # the worth model (weekly budget LP)
webapp/src/lib/acquire.js         # cheapest plan for a set of needs (Compare)
webapp/src/lib/spend-tracks.js    # spend reward tracks (tier costs, track points per purchase)
webapp/src/lib/lp.js              # HiGHS wrapper (LP text builder, duals); highs-browser.js locates the .wasm
webapp/src/lib/valuation.js       # the one worth interface for the pages
webapp/src/lib/valuation-panel.js # shared controls (weekly spend, events, tracks)
webapp/src/lib/settings.js        # localStorage settings incl. item priorities (Don't care/Low/Normal/High)
webapp/src/i18n/{en,de}.json      # de.json values are intentionally blank placeholders, not missing data
```

The pure modules (`catalog`, `point-fit`, `item-values`, `planner`, `acquire`, `lp`, `spend-tracks`) have no
DOM/i18n dependency and use explicit `.js` import extensions, so Node scripts (`scripts/verify-data.js`) can import
them. Keep it that way.

## Conventions

- `data/pack_data.json` is auto-processed on commit (husky + lint-staged): sort → update-last-updated → prettier.
- Don't hardcode item points in `pack_data.json`; worth comes from the deal % fit and the user's priorities. Fix a
  bad value with better data (contents, deal %, `crafted_from`, `value_equivalent`, ...).
- Don't fill in `de.json` blanks unless asked to.

## Formatting Conventions

- Numbers in tables: thousand separators, right-aligned, consistent decimal padding.
- Item/package names on ranking pages include the tier suffix.

## Reference Documents

- `README.md` — webapp pages, valuation model, GitHub Pages deployment.
- `data/pack_data.schema.json` — full shape of `pack_data.json`.
