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

- NEVER commit, create branches, push to remote, or open PRs unless explicitly asked. Leave changes in the working
  tree.
- Never downgrade dependency or GitHub Action versions to "fix" a problem. If a version looks wrong, ask first.

## Conventions

- `data/pack_data.json` is auto-processed on commit (husky + lint-staged): sort → update-last-updated → prettier.
- Don't hardcode item points in `pack_data.json`; worth comes from the deal % fit and the user's priorities. Fix a
  bad value with better data (contents, deal %, `crafted_from`, `value_equivalent`, ...).
- Any change, addition or removal in `webapp/src/i18n/en.json` must be mirrored in `de.json` in the same change
  (translate it yourself; same keys and order, `{placeholders}` unchanged).
- Never translate `name.de` in `data/pack_data.json` yourself: those are taken manually from the game, not guessed.
  Leave them blank (`npm run i18n:missing` lists them).
- Where texts live: names of the data's entities (items, packages, events, shops, tracks, heroes) in
  `pack_data.json` as `name: { en, de }` (`en` required), and an event's optional short `description: { en, de }`;
  UI texts and the labels of the data's codes (`category.*`, `sourceType.*`, `weekday.*`, `gear.class.*`,
  `gear.faction.*`, looked up with `enumLabel(group, code)`) in `en.json` / `de.json`. A new category or other code
  needs its label in both (`i18n:missing` and `verify-data` list missing ones). A translation is plain text; when a
  placeholder holds markup or an escaped name, use `tHtml()`, which escapes the text itself. A new language: its
  dictionary in `LOCALES` (`ui/i18n.js`) and its key in the schema's `localizedString`.
- Gold is reserved for Banknote amounts (`banknotesHtml`); diamonds are blue, other numbers plain.

## Formatting Conventions

- Numbers in tables: thousand separators, right-aligned, consistent decimal padding.
- One number style in every language (`format.js`): apostrophe thousands, point decimals (20'000, 1.423, 2.6 ★).
  Dates are localized.
- Grid columns that only matter on wide screens are marked `wide` (`ui/grid.js`); phones (≤ 640 px) drop them.
- Item/package names on ranking pages include the tier suffix.

## Commands

```bash
npm run verify-data                                          # validate data/pack_data.json (schema, references, item worth, pack worth vs deal %, code labels)
npm run lint                                                  # eslint .
npm test                                                      # node:test: unit tests + golden files (test/)
UPDATE_GOLDEN=1 npm test                                      # rewrite test/golden/*.json (only for an intended change)
npm run webapp:dev                                            # vite dev server (imports data/pack_data.json directly)
npm run webapp:build                                          # vite build -> webapp/dist
npm run webapp:preview                                        # serve the built webapp/dist
npm run i18n:missing -- [lang] [--keys-only] [--data-only]     # missing translations (UI texts, code labels, data names)
npm run record-run -- <ids...> [START] <DAYS> | --show [ids]  # record when events / passes / tracks run
```

Tests (`test/`, run in CI before deploying) are unit tests on small inline data plus golden tests that pin the fit,
the weekly plan, Compare, Item Sources and the gear path order on a frozen copy of the data
(`test/fixtures/pack_data.json`). A data change doesn't touch them; a model change that moves a number fails them.
If that is intended, explain the diff, then run `UPDATE_GOLDEN=1 npm test`. HiGHS breaks ties by row order, so
reordering the model's rows can swap one equally good shopping list for another (same points, other packs).

## Architecture

One npm package (ESM). The HTML pages stay in `webapp/` (their URLs are the GitHub Pages URLs); each loads
`webapp/src/pages/<page>.js`, which starts with `startPage` (`ui/page.js`).

- `webapp/src/core/` holds the pure modules (fit, valuation, planner, Compare, schedule, gear path, ...). No DOM or
  i18n, imports only `core/`, explicit `.js` extensions; ESLint fails on `document`, `window` or a `../ui` import.
  Scripts and tests import it directly. Core modules take the data from `normalizePackData`, not the raw file.
  Each module's header comment says what it does; read it before changing the module.
- `webapp/src/ui/` holds the browser helpers (settings in localStorage, i18n, formatting, grids, the setup bar).
- `webapp/src/i18n/{en,de}.json` holds UI texts and code labels. `scripts/` holds verify-data, i18n:missing,
  record-run and the commit hooks.
- Pages read their selection from the URL (`?item=`, `?event=`, `?track=`, Compare's `?a=&an=&b=&bn=&days=`), so
  links between pages and reloads keep it.

### Data rules worth knowing

- `schedule` records per event, seasonal pass family and spend reward track its runs as inclusive dates; add them
  with `record-run`. Events with `"category": "ingame_event"` have no packs or shop. "Today" is always the game day,
  which starts at 02:00 UTC (`gameDay` in `core/schedule.js`). The setup bar's "Follow the calendar" switch (default on) sets the
  selected events and passes to today's on every page load (`ui/calendar-sync.js`, called in `startPage`); a manual
  event / pass change turns it off.
- Spend reward tracks share one list of Banknote packs and the points they count (`spend_reward_conversions`);
  `normalizePackData` gives it to every track without its own `conversions` (`[]` = 1 point per Banknote).
- `image` on events, tracks and passes is a banner in `webapp/public/assets/events/` (720×360); `verify-data`
  checks the file.
- The Gear Upgrade Path page reads `heroes`, `gear_upgrades` and `squad_guides`; `mergePaths` (`core/gear-path.js`)
  orders its three paths, and `verify-data` reports paths that deadlock.

## Valuation Model

Every item has a worth in **points** (a relative scale; diamonds = 1, as the in-game deal % counts them). Nothing
is stored in `pack_data.json`: `point-fit.js` fits the "leaf" items live from every pack's deal %, and everything
else is derived from its structure (`contains`, random `drop_table`, `choice`, `substitutes_for`,
`value_equivalent`, `reversible` chains, `crafted_from` recipes). A single-entry `value_equivalent` makes a value
level chain (worth only, the levels can't be crafted). Currencies (diamonds, event coins) have no points of their
own — they're worth only what their shop offers buy; an item that opens into a currency (a Magic Hat Lucky Box,
the Diamond Golden Egg) is worth that currency at its marginal value too (`itemPoints` in `planner.js`).

- The user's item priorities (Don't care / Low / Normal / High = 0 / 50 / 100 / 150 %) multiply values after the
  fit. Alliance chests, ... start at Don't care but stay in the fit; VIP points are fixed at 0 in the fit itself
  (`zeroItems`, everywhere) unless the Home page's "Count VIP points" setting (default off) is on. Moon Coins and Star Moon Sigils are
  deliberately unmodelled (`UNMODELLED_ITEMS`).
- There is ONE model (`valuation.js`): the weekly-budget MILP/LP (`planner.js`, HiGHS) maximizing points under
  purchase limits at the user's weekly spend; worth = points ÷ the marginal points per Banknote. Every page uses it
  (Spend Rewards re-solves it per tier); the Shopping Plan shows an event's slice plus what-if options.
- Compare is the exception: `acquire.js` (`solveNeeds`) is an exact minimum-cost MILP over every conversion,
  weekday-aware, counting only what random chests guarantee. Shop progress points (`bonus_tiers`, `unlock_points`)
  apply to the weekly plan only.
- Locks on shop offers (`lockedOffers`, set on the Shopping Plan) apply to the ONE plan on every page.

## Reference Documents

- `README.md` — webapp pages, valuation model, GitHub Pages deployment.
- `data/pack_data.schema.json` — full shape of `pack_data.json`.
