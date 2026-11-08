# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Klingo's Companion (Last Asylum: Plague)

A static webapp that values items, packages and exchange-shop offers from `data/pack_data.json` (mobile game
"Last Asylum: Plague"), computed live in the browser, deployed to GitHub Pages.

## Scope Discipline

- Prefer the smallest change that solves the stated problem. Do not add new schema sections, sync scripts, npm
  commands, or lint-staged wiring unless asked.
- A bigger change leaves no technical debt behind. Remove what it makes dead (functions, exports, imports, CSS rules,
  state, i18n keys, tests), merge what it duplicates, follow the established patterns of the surrounding code, and
  update the header comments and docs it affects. The codebase must be in a well-maintained state afterwards. That
  cleanup is part of the change, not a separate refactor.
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
  `pack_data.json` as `name: { en, de }` (`en` required), and an event's or an item's (regular or choice) optional short `description: { en, de }`;
  UI texts and the labels of the data's codes (`category.*`, `sourceType.*`, `weekday.*`, `gear.class.*`,
  `gear.faction.*`, looked up with `enumLabel(group, code)`) in `en.json` / `de.json`. A new category or other code
  needs its label in both (`i18n:missing` and `verify-data` list missing ones). A translation is plain text. A
  `t()` text goes into markup only through `tHtml(key, vars)` (it escapes the text, inserts `vars` as given, so they must
  be markup-safe already; it works without `vars`), or into an attribute through `escapeAttr(t(...))`. Never a raw
  `${t(...)}` in a template or `escapeHtml(t(...))`; `t()` stays for plain text (`textContent`, tooltip text). A new language: its
  dictionary in `LOCALES` (`ui/i18n.js`) and its key in the schema's `localizedString`.
- Gold is reserved for Banknote amounts (`banknotesHtml`); diamonds are blue, other numbers plain.

## Formatting Conventions

- Numbers in tables: thousand separators, right-aligned, consistent decimal padding.
- One number style in every language (`format.js`): apostrophe thousands, point decimals (20'000, 1.423, 2.6 ★).
  Dates are localized.
- Runs and other moments are shown in the user's local time (`formatRunRange`, `formatMoment`, `formatDate`), the
  Calendar's charts on local days; game days (starting at the 02:00 UTC reset) stay internal, for the logic only.
- Grid columns that only matter on wide screens are marked `wide` (`ui/grid.js`); phones (≤ 640 px) drop them.
- Item/package names on ranking pages include the tier suffix.

## Commands

```bash
npm run verify-data                                          # validate data/pack_data.json (schema, references, item worth, pack worth vs deal %, code labels)
npm run lint                                                  # eslint .
npm run format:check                                          # prettier --check (npm run format fixes); CI runs it with lint
npm test                                                      # node:test: unit tests + golden files (test/)
npm run test:coverage                                         # the same with Node's coverage of core/, ui/, scripts/; fails below 90 % lines / 85 % branches / 90 % functions
UPDATE_GOLDEN=1 npm test                                      # rewrite test/golden/*.json (only for an intended change)
npm run webapp:dev                                            # vite dev server (imports data/pack_data.json directly)
npm run webapp:build                                          # vite build -> webapp/dist
npm run webapp:preview                                        # serve the built webapp/dist
npm run i18n:missing -- [lang] [--keys-only] [--data-only]     # missing translations (UI texts, code labels, data names)
npm run record-run -- <ids...> [START] <DAYS> | --show [ids]  # record when events / passes / tracks run
```

Tests (`test/`, run in CI before deploying) mirror the source: `test/core/<module>.test.js`, `test/ui/` (the ui modules
run in Node on the stand-in browser of `test/ui/env.js`), `test/scripts/`; `test/helpers.js` has the fixture, HiGHS and
fit setup, the schedule's game days and `near`. They are unit tests on small inline data plus golden tests that pin the fit,
the weekly plan, Compare, Item Sources and the gear path order on a frozen copy of the data
(`test/fixtures/pack_data.json`). A data change doesn't touch them; a model change that moves a number fails them.
If that is intended, explain the diff, then run `UPDATE_GOLDEN=1 npm test`. HiGHS breaks ties by row order, so
reordering the model's rows can swap one equally good shopping list for another (same points, other packs).
CI runs `test:coverage` (the table goes to the job summary, `coverage/lcov.info` is an artifact). Node lists only the
files a test imports, so the DOM-bound ui modules and `pages/` don't show; raise the thresholds in `package.json` when
the coverage grows.

## Architecture

One npm package (ESM). The HTML pages stay in `webapp/` (their URLs are the GitHub Pages URLs); each loads
`webapp/src/pages/<page>.js` (`<page>/index.js` for the big pages: Events, Gear, Calendar; their sections are modules next to
it, the shared state is `ctx` in `state.js`), which starts with `startPage` (`ui/page.js`).

- `webapp/src/core/` holds the pure modules (fit, planner, Compare, schedule, gear path, ...). No DOM or i18n, imports
  only `core/` (and the `highs` package in `lp.js`), explicit `.js` extensions; ESLint fails on `document`, `window` or a
  `../ui` import. Scripts and tests import it directly. Core modules take the data from `normalizePackData`, not the raw
  file. Each module's header comment says what it does; read it before changing the module. Logic a page needs goes
  here, not into the page: `settings-model.js` (defaults, priorities, the planner options the settings make),
  `event-plan.js` and `plan-view.js` (what the Events, Today and Ranking pages show of a plan), `step-analysis.js` (the
  "spend more" tables), `gear-progress.js` (the gear page's progress), plus the page-specific parts of `catalog.js`,
  `schedule.js`, `mine.js` and `item-sources.js`.
- `webapp/src/ui/` holds the browser helpers: `valuation.js` (the worth model on top of the planner), `valuation-page.js`
  (the setup bar and the valuation every valuation page starts with), `settings.js` and `storage.js` (localStorage: every key is listed in `STORAGE_KEYS`, prefix `lapkc_`; a new one goes there),
  `i18n.js`, `format.js`, `datetime.js`, `html.js`, `labels.js`, `url.js`, `grid.js` and the other builders of markup.
- `webapp/src/styles/` holds the CSS: `base.css` (tokens, reset, layout, forms), `components/*.css` (loaded on every page by
  `ui/page.js`, in that order) and `pages/<page>.css` (the page script imports its own, after the shared ones). A rule keeps
  its place inside its file; a rule that overrides another of the same specificity (a phone `@media` over the base rule) lives
  in the same file or a later-loaded one.
- `webapp/public/assets/` holds the images: `items/<category>/` (images not sorted yet are found directly in `items/`),
  `events/`, `heroes/`, `lord/`, `gear/{stars,classes,factions}/` and `ui/` (the placeholder icon, the Banknote icon).
- `webapp/src/i18n/{en,de}.json` holds UI texts and code labels. `scripts/` holds verify-data, i18n:missing,
  record-run and the commit hooks (`scripts/lib/` holds what they share: the data file paths and JSON format, the
  code labels). A script exports its pure parts for the tests and runs `main()` only when started directly.
- Pages read their selection from the URL (`?item=`, `?event=`, `?track=`, Compare's `?a=&an=&b=&bn=&days=`), so
  links between pages and reloads keep it.

### Data rules worth knowing

- `schedule` records per event, seasonal pass family and spend reward track its runs as inclusive dates; add them
  with `record-run`. Forecasts (`forecastRuns`) are `proven` (a repeating pattern) or a rough guess (median gap,
  shown fainter). `scheduleRuns(data, today)` adds the proven forecast runs up to today, so they count as runs
  everywhere (Calendar, Today, Follow the calendar, skips); without `today` it is the recorded runs only (`record-run`).
  8 weeks after an id's last recorded run its pattern is `stale`: a rough guess again until recorded (`record-run --show`
  lists those). Shop events are the ones with packs or a shop; gameplay events (`"category": "ingame_event"`) have none; an event's optional `calendar_group` (`spend_rewards`, `alliance`) moves it to another Calendar group. "Today" is always the game day,
  which starts at 02:00 UTC (`gameDay` in `core/schedule.js`). The setup bar's "Follow the calendar" switch (default on) sets the
  selected events and passes to today's on every page load (`ui/calendar-sync.js`, called in `startPage`); a manual
  event / pass change turns it off.
- `event_rotations` holds gameplay events (`ingame_event`) that run through a fixed list of slots on a fixed clock (Survival Battle: 42
  slots of 4 hours from Sunday's reset, the same week every week): `phases` (id, name, an optional `image` and optional
  `earn_points`: the game's rule as text, `item_id` for the item the rule is about) and `week`, the phase of every slot. The
  sequence is as the game runs it, not a loop (a round of five, Territory > Heroes, then seven rounds of five), so
  every slot is listed. `rotationSlots` (`core/schedule.js`) gives the phase on now and the next; the Today page shows
  them. The event itself stays a plain `ingame_event` in `events`. Times are UTC; the game's server time is UTC−2 (its
  00:00 = our 02:00).
- Spend reward tracks share one list of Banknote packs and the points they count (`spend_reward_conversions`);
  `normalizePackData` gives it to every track without its own `conversions` (`[]` = 1 point per Banknote).
- `image` on events, tracks and passes is a banner in `webapp/public/assets/events/` (720×360); `verify-data`
  checks the file.
- The Gear Upgrade Path page reads `heroes`, `gear_upgrades` and `squad_guides`; `mergePaths` (`core/gear-path.js`)
  orders its three paths, and `verify-data` reports paths that deadlock.
- The Lord Specialty page reads its own file, `data/lord_specialty.json` (schema `lord_specialty.schema.json`, checked
  by `verify-data`, not part of `pack_data.json`). A lord's talent order is the build's order in shared URLs
  (`core/lord-specialty.js`), so don't reorder or insert talents casually. Talents above `max_level` show as "not in
  the current season".

## Valuation Model

Every item has a worth in **points** (a relative scale; diamonds = 1, as the in-game deal % counts them). Nothing
is stored in `pack_data.json`: `point-fit.js` fits the "leaf" items live from every pack's deal %, and everything
else is derived from its structure (`contains`, random `drop_table`, `choice`, `substitutes_for`,
`value_equivalent`, `reversible` chains, `crafted_from` recipes). A single-entry `value_equivalent` makes a value
level chain (worth only, the levels can't be crafted). Currencies (diamonds, event coins) have no points of their
own — they're worth only what their shop offers buy (at most the best offer with room left, `capCurrencyRates`, so
reached bonus tiers don't make a coin worth what its packs cost); an item that opens into a currency (a Magic Hat Lucky Box,
the Diamond Golden Egg) is worth that currency at its marginal value too (`itemPoints` in `planner.js`).

- The user's item priorities (Don't care / Low / Normal / High = 0 / 50 / 100 / 200 %) multiply values after the
  fit. Alliance chests, ... start at Don't care but stay in the fit; VIP points are fixed at 0 in the fit itself
  (`zeroItems`, everywhere) unless the Settings page's "Count VIP points" setting (default off) is on. Moon Coins and Star Moon Sigils are
  deliberately unmodelled (`UNMODELLED_ITEMS`).
- There is ONE model (`ui/valuation.js` over `core/planner.js`): the weekly-budget MILP/LP (`planner.js`, HiGHS) maximizing points under
  purchase limits at the user's weekly spend; worth = points ÷ the marginal points per Banknote. Every page uses it
  (Spend Rewards re-solves it per tier); Event Shops shows an event's slice plus what-if options.
- Compare is the exception: `acquire.js` (`solveNeeds`) is an exact minimum-cost MILP over every conversion,
  weekday-aware, counting only what random chests guarantee and a shop's free currency (`income_per_hour`) over the
  window. Shop progress points (`bonus_tiers`, `unlock_points`) apply to the weekly plan only.
- Locks on shop offers (`lockedOffers`, set on Event Shops) apply to the ONE plan on every page.
- So do skipped packs (`skippedPackages`: package id -> the first game day the skip ends, set by "Skip" on the Deal
  Ranking; `core/skips.js`, planner option `skippedPackages`). A skip lasts until the weekly reset or the end of the
  pack's event / pass run, and takes the higher tiers that `requires` the skipped one along.

## Reference Documents

- `README.md` — what the project is, how to run, edit, test and deploy it.
- `docs/pages.md` — the pages one by one; `docs/valuation.md` — how the worth is calculated, the schedule and its forecasts.
- `data/pack_data.schema.json` — full shape of `pack_data.json`.
