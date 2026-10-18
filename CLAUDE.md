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
npm run verify-data                                          # validate data/pack_data.json (schema, references, item worth, code labels)
npm run lint                                                  # eslint .
npm test                                                      # node:test: unit tests + golden files (test/)
UPDATE_GOLDEN=1 npm test                                      # rewrite test/golden/*.json (only for an intended change)
npm run webapp:dev                                            # vite dev server (imports data/pack_data.json directly)
npm run webapp:build                                          # vite build -> webapp/dist
npm run webapp:preview                                        # serve the built webapp/dist
npm run i18n:missing -- [lang] [--keys-only] [--data-only]     # missing translations (UI texts, code labels, data names)
npm run record-run -- <ids...> [START] <DAYS> | --show [ids]  # record when events / passes / tracks run
```

`schedule` in `pack_data.json` records per event, seasonal pass family and spend reward track its runs as
inclusive `{ start, end }` dates (`record-run` computes the end from the start and the number of days). Events with
`"category": "ingame_event"` have no packs or shop and are only tracked there (not offered under "Events this
week"). The Calendar page (`calendar.html`, Events menu) shows it as the "Event Schedule" timeline (last week, this
week, 4 ahead) with a simple forecast (`core/schedule.js`: ids with at least two runs repeat their median gap between
starts and median length). Below it, "Weekday Offers" charts the `weekly_rotation` packs for today and the next 6 days from their
`available_days` (not recorded, not forecast), with a "Now" line that moves every minute. "Today" is always the
game day, which starts at 02:00 UTC (`gameDay` in `core/schedule.js`): both charts, the events / passes / tracks
running today, Compare's start weekday and `record-run`'s default start.

The Gear Path page (`gear.html`) reads `heroes`, `gear_upgrades` and `squad_guides`: a squad's formation by
slot (not by hero; each slot has a hero class, tank / carry / support, and lists its hero per hero faction,
`heroes: { warrior, ranger, warlock }`; a switch on the page picks the faction, the factions share the paths) and
three paths, each in its own order: `craft_path` (one piece per step), `level_path` and
`star_path` (target states, "carries' swords → Lv 40"). The page is a guide in two phases: all crafting first, then
the next level step and the next star step, one card each (the user picks; star steps use the gear set's
`blueprints`). Levels and stars constrain each other (level cap by whole stars, minimum level per star):
`mergePaths` in `core/gear-path.js` orders the three (crafting, then levels first, stars when a level step needs
them) and derives what each step needs from the other queue; a blocked step names it, and `verify-data` reports
paths that deadlock. Progress is saved in localStorage (`lasps_gear_progress`: per guide the faction
shown last and per faction: per queue the done steps in the order they were done, plus `mrOnHold`: "no Gear Blueprint (MR)
yet" holds the 5 ★ steps, the others go on). Stars are written 0, 0.2, …, 4,
5 (MR) and counted as steps 0–21.

Tests (`test/`, Node's built-in `node:test`, run in CI before deploying): unit tests of the core modules on small
inline data, and golden tests that pin the fit, the weekly plan (several settings), Compare, Item Sources and the
gear path order on a frozen copy of the data (`test/fixtures/pack_data.json`), compared with a 1e-6 relative
tolerance. A change to the data doesn't touch them; a change to the model that moves a number fails them. If the
change is intended, explain the diff, then rewrite the goldens with `UPDATE_GOLDEN=1 npm test`. To test on newer
data, copy `data/pack_data.json` over the fixture and rewrite the goldens. Note: HiGHS stops within a 0.01 %
optimality gap and breaks ties by row order, so reordering the model's rows can swap one equally good shopping
list for another (same points, other packs).

## Valuation Model

Every item has a worth in **points** (a relative scale; diamonds = 1, as the in-game deal % counts them). Nothing
is stored in `pack_data.json`: `point-fit.js` fits the "leaf" items live from every pack's deal % (robust log-space
least squares, shop offers as weak extra equations, data-derived ties), and everything else is derived from its
structure (`contains` = sum, random `drop_table` = expected value, `choice` = best options, `substitutes_for` =
best target, `value_equivalent` = sum of the listed items, `reversible` crafting chains propagate one value both
ways, `crafted_from` recipes cap an item at its ingredients and weakly tie it to them; a single-entry
`value_equivalent` makes a value level chain, e.g. raven gear Lv.1 → Lv.3 → Lv.5 at 9:1, worth only: the levels
can't be crafted). Item Priorities lists every chain once, under its top item, with the priority on its base; Item
Sources groups only convertible (reversible) chains and lists value levels each (`itemChainTops` in
`core/item-sources.js`). `fitSensitivity` (leave one
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

One npm package (root `package.json`, ESM). The HTML pages stay in `webapp/` (their URLs are the GitHub Pages URLs).

```
data/pack_data.json                 # source of truth, schema-validated by data/pack_data.schema.json
scripts/                            # verify-data, i18n:missing (+ code-labels.js), record-run, sort / last-updated (commit hook)
test/                               # node:test files, helpers.js, fixtures/pack_data.json (frozen), golden/*.json
webapp/*.html                       # one page each; the script is webapp/src/pages/<page>.js
webapp/src/core/                    # pure modules (no DOM, no i18n; lint-enforced), shared with scripts and tests:
  pack-data.js                      #   normalizePackData: tier ladders expanded once, the shape every core module reads
  items.js                          #   an item's kind (equivalent/random/choice/contains/substitute/recipe/leaf)
  catalog.js                        #   purchase limits per week / per window, isOnSale, purchaseType, bundles
  point-fit.js                      #   base points fitted live from deal % (+ leave-one-out sensitivity)
  item-values.js                    #   points resolution (base points + structure + priority weights)
  planner.js                        #   the worth model (weekly budget MILP + LP for the rates)
  acquire.js                        #   cheapest plan for a set of needs (Compare)
  package-rows.js                   #   rules between packages (tiers, exclusive groups, bundles) for both MILPs
  lp.js                             #   HiGHS wrapper (LP text builder, duals)
  spend-tracks.js, item-sources.js, schedule.js, gear-path.js
webapp/src/ui/                      # browser helpers:
  page.js                           #   startPage(id, { init, onLocaleChange }): nav, texts, data, error card
  settings.js                       #   localStorage settings + the store (getSettings / updateSettings / onSettingsChange)
  valuation.js                      #   the one worth interface for the pages; highs-browser.js locates the .wasm
  valuation-panel.js                #   setup bar (weekly spend, events, passes, calendar dots, rate chip)
  grid.js, html.js, labels.js       #   ranking-grid builders + Details toggles, escaping / icons, names + item links
  i18n.js, format.js, url.js, ...   #   t / tHtml / enumLabel, Swiss number format, selection in the URL
webapp/src/pages/                   # one entry per page (rankings.js, events.js, gear.js, ...)
webapp/src/i18n/{en,de}.json        # UI texts and code labels; de.json is translated and kept in sync with en.json
```

`webapp/src/core/` has no DOM/i18n dependency, imports only `core/` and uses explicit `.js` extensions, so Node
scripts and tests import it directly; ESLint fails on `document`, `window` or a `../ui` import there. Core modules
take the normalized data (`normalizePackData`), not the raw file. Pages pick their selection up from the URL
(`?item=`, `?event=`, `?track=`, Compare's `?a=&an=&b=&bn=&days=`), so links between pages and reloads keep it.

## Conventions

- `data/pack_data.json` is auto-processed on commit (husky + lint-staged): sort → update-last-updated → prettier.
- Don't hardcode item points in `pack_data.json`; worth comes from the deal % fit and the user's priorities. Fix a
  bad value with better data (contents, deal %, `crafted_from`, `value_equivalent`, ...).
- Any change, addition or removal in `webapp/src/i18n/en.json` must be mirrored in `de.json` in the same change
  (translate it yourself; same keys and order, `{placeholders}` unchanged).
- Never translate `name.de` in `data/pack_data.json` yourself: those are taken manually from the game, not guessed.
  Leave them blank (`npm run i18n:missing` lists them).
- Where texts live: names of the data's entities (items, packages, events, shops, tracks, heroes) in
  `pack_data.json` as `name: { en, de }` (`en` required); UI texts and the labels of the data's codes (`category.*`,
  `sourceType.*`, `weekday.*`, `gear.class.*`, `gear.faction.*`, looked up with `enumLabel(group, code)`) in
  `en.json` / `de.json`. A new category or other code needs its label in both (`i18n:missing` and `verify-data`
  list missing ones). A translation is plain text; when a placeholder holds markup or an escaped name, use
  `tHtml()`, which escapes the text itself. A new language: its dictionary in `LOCALES` (`ui/i18n.js`) and its
  key in the schema's `localizedString`.
- Gold is reserved for Banknote amounts (`banknotesHtml`); diamonds are blue, other numbers plain.

## Formatting Conventions

- Numbers in tables: thousand separators, right-aligned, consistent decimal padding.
- One number style in every language (`format.js`): apostrophe thousands, point decimals (20'000, 1.423, 2.6 ★).
  Dates are localized.
- Grid columns that only matter on wide screens are marked `wide` (`ui/grid.js`); phones (≤ 640 px) drop them.
- Item/package names on ranking pages include the tier suffix.

## Reference Documents

- `README.md` — webapp pages, valuation model, GitHub Pages deployment.
- `data/pack_data.schema.json` — full shape of `pack_data.json`.
