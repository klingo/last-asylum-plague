# Klingo's Companion for Last Asylum: Plague

[![Verify and deploy](https://github.com/klingo/last-asylum-plague/actions/workflows/deploy-webapp.yml/badge.svg)](https://github.com/klingo/last-asylum-plague/actions/workflows/deploy-webapp.yml)

A small static webapp that values the items, packages and exchange-shop offers of the mobile game **Last Asylum:
Plague** from `data/pack_data.json`. Everything is computed live in the browser (no server) and deployed to GitHub
Pages: **https://klingo.github.io/last-asylum-plague/**

It answers "what is this pack worth at my weekly spend?": a Deal Ranking of every package on sale, the plan for each
event shop, seasonal passes and spend reward tracks, item sources, comparisons, a calendar of what runs when, and
planners for gear upgrades, hero skills and the lord's specialty skills. Texts are in English and German.

- [docs/pages.md](docs/pages.md): every page and what it shows.
- [docs/valuation.md](docs/valuation.md): how the worth is calculated, and how the schedule and its forecasts work.

## Quick start

Needs Node.js 22.13 or newer (the tests of the sync server use Node's built-in SQLite).

```bash
npm install                    # first time only (one package for everything)
npm run webapp:dev             # Vite dev server; the app imports data/pack_data.json directly
npm run webapp:build           # production build into webapp/dist (npm run webapp:preview serves it)
npm run lint                   # eslint
npm run format:check           # prettier --check (npm run format fixes)
```

## Project structure

```text
data/                   pack_data.json (+ schema) and lord_specialty.json (+ schema): the game's data
webapp/                 the HTML pages (their URLs are the Pages URLs), vite.config.js
  src/core/             the valuation and planning: pure modules without DOM, shared with the scripts and tests
  src/ui/               browser helpers: settings, i18n, formatting, grids, the setup bar
  src/pages/            one script per page (a folder with index.js and a module per section for the big ones)
  src/styles/           base.css, components/ (every page) and pages/ (one file per page)
  src/i18n/             en.json and de.json: UI texts and the labels of the data's codes
  public/assets/        images: items/<category>/, events/, heroes/, lord/, gear/, ui/
scripts/                verify-data, i18n:missing, record-run and the commit hooks (lib/: what they share)
worker/                 the sync server (Cloudflare Worker + D1), deployed on its own; see "Sync server" below
test/                   unit tests (core/, ui/, scripts/, worker/) and golden tests on a frozen copy of the data
docs/                   pages.md and valuation.md
```

## Editing the data

1. Edit `data/pack_data.json` (its shape: `data/pack_data.schema.json`).
2. `npm run verify-data` checks the schema, the references, items without a worth, packs far off their deal %, code
   labels and the image files.
3. On commit, a hook sorts the file, stamps `metadata.last_updated` and formats it (husky + lint-staged).
4. `npm run i18n:missing -- de` lists what German still lacks: UI texts, code labels and data names. The German names
   in the data are taken from the game by hand, never translated or guessed.
5. `npm run record-run -- <ids...> [START] <DAYS>` records when events, seasonal passes and spend reward tracks run
   (`--show` lists them), e.g. `npm run record-run -- strange_bazaar 2026-10-12 7`. The deployed site can do it too:
   **Settings → Admin** starts the `record-run` workflow, which commits the run to `master` and redeploys. It needs a
   fine-grained personal access token (GitHub → Settings → Developer settings) for this repository with only
   **Actions: Read and write**, pasted into that section once per browser. The workflow can also be started by hand from
   the repository's Actions tab.

Item images: drop a `<item_id>.png` into `webapp/public/assets/items/<category>/` (e.g. `items/chest/`; images not
sorted yet are also found directly in `items/`, a placeholder shows otherwise). An item's `rarity` (`mr`, `ur`, `ssr`,
`sr`, `r`, or `null` for none) colours its image's border.

## Testing

```bash
npm test                       # unit tests + golden tests (test/)
npm run test:coverage          # the same with coverage of core/, ui/, scripts/ and worker/ (coverage/lcov.info)
UPDATE_GOLDEN=1 npm test       # rewrite test/golden/*.json, only for a change of the model that is intended
```

The unit tests run on small inline data; the golden tests pin the fit, the weekly plan, Compare, Item Sources and the
gear path order on a frozen copy of the data (`test/fixtures/pack_data.json`), so a data change doesn't move them but a
change of the model does. `test:coverage` fails below 90 % lines, 85 % branches and 90 % functions (set in
`package.json`) and counts the files the tests import: the DOM-bound code (`pages/`, parts of `ui/`) is not in it.

## Deploying to GitHub Pages

`.github/workflows/deploy-webapp.yml` verifies the data, checks the code (lint and formatting), tests with coverage and
builds the webapp with the current `data/pack_data.json`; every push to `master` (or "Run workflow") then deploys it
once all four jobs have passed. The same checks run on every pull request into `master`, without deploying. Since the
webapp computes everything live from that data, the deployed site is always in sync with `data/pack_data.json` at
deploy time.

Every page footer shows two stamps: when the data was last updated (`metadata.last_updated`) and when the site last
changed. The second is filled in at build time (`__LAST_CHANGE__` in `webapp/vite.config.js`) from the date of the
latest commit, so a rebuild without a change keeps it, and a code-only change updates it.

One-time repository setup: in **Settings → Pages**, set **Source** to **GitHub Actions**. To make a pull request need
passing checks before it can be merged, add a branch protection rule (or ruleset) for `master` under **Settings →
Branches** with **Require status checks to pass before merging** and select `verify-data`, `lint`, `test` and `build`.

Dependabot proposes updates to the npm packages and the GitHub Actions every week (`.github/dependabot.yml`).

## Sync server

The Sync page (the header's Sync button) keeps settings and progress the same on a user's devices. The site is static, so this needs one small
backend: `worker/` is a Cloudflare Worker with a D1 database (both on the free plan; a flood of requests can only use
up the daily limits, it can't cost anything). It isn't part of the Pages deployment and is set up once by hand, from
`worker/`:

```bash
npx wrangler login
npx wrangler d1 create last-asylum-plague-sync                          # put the printed database_id into wrangler.toml
npx wrangler d1 execute last-asylum-plague-sync --remote --file schema.sql
npx wrangler deploy                                         # prints the Worker's URL
```

Then set `SYNC_URL` in `webapp/src/ui/sync.js` to that URL and, if the site is served from another origin than
`https://klingo.github.io`, `ALLOWED_ORIGINS` in `wrangler.toml`. Until `SYNC_URL` is set the Sync button stays hidden.
To try it locally, run `npx wrangler d1 execute last-asylum-plague-sync --local --file schema.sql` and `npx wrangler dev` in
`worker/`, and point `SYNC_URL` at `http://localhost:8787` (the Vite dev server on localhost may call it; to scan the QR
code with a phone on the LAN, add the dev server's address to `ALLOWED_ORIGINS` in `worker/.dev.vars`). The Worker's
header comment describes its routes and abuse guards.

## Disclaimer

This is a fan-made tool. It is not affiliated with, endorsed by or connected to the publisher of Last Asylum: Plague.
The game's names, art and data belong to their owners.
