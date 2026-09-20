# Last Asylum Pack Solver

CLI scripts to analyze packages/exchange shops from `data/pack_data.json` (Last Asylum: Plague), plus a small
static webapp (in `webapp/`) that renders the same analysis in the browser and is deployed to GitHub Pages.

## CLI scripts

See `package.json` for the full list. The most relevant ones:

- `npm run analyze-item-value -- <item_id> [target_quantity]` — best way to buy a given item.
- `npm run rank-packages` — ranks every package/exchange offer/bonus tier by value for money, writing
  `output/value_ranking.json`.

## Webapp

The `webapp/` folder is a small [Vite](https://vitejs.dev/) app with four pages:

- **Welcome** (`index.html`) — a landing page introducing the tool and linking to the pages below.
- **Analyze Item Value** (`analyze.html`) — pick an item, an amount, and optionally exceed purchase limits; renders
  the same purchase-plan calculation as `analyze-item-value.js`, directly in the page.
- **Value Ranking** (`rankings.html`) — a searchable, filterable ranking of every package/exchange offer/bonus
  tier by value for money.
- **Best Choice Pick** (`choices.html`) — pick a choice chest or package (anything that lets you select one or more
  rewards from a pool) and see its options ranked by what each reward would cost to buy elsewhere, so you know
  which pick is worth the most.

All three analysis pages compute everything live in the browser from `data/pack_data.json`; nothing is
pre-generated. This matters because the effective cost of buying an item is dynamic: it depends on the target
quantity and on shared purchase-limit capacities (e.g. a cheap "100 Strange Coins" exchange offer that's capped at
once per day still only covers the first 100 coins needed — the rest has to come from a pricier source), so it
can't be flattened into a single static number ahead of time. See `webapp/src/lib/pricing-core.js` (`createMarket`)
for the purchase-simulation logic, ported from `scripts/lib/pricing.js`: the CLI is CommonJS/Node and the webapp is
browser-only ESM, so the two are mirrored by hand rather than literally shared — see `CLAUDE.md` for details.

Both analysis pages show per-item images where available: drop a `<item_id>.png` file into
`webapp/public/assets/items/` and it will be picked up automatically (items without an image fall back to a
placeholder icon).

### Running locally

```bash
npm run copy-pack-data         # copies data/pack_data.json into webapp/public/data
npm run webapp:install         # first time only
npm run webapp:dev             # starts the Vite dev server
```

### Deploying to GitHub Pages

`.github/workflows/deploy-webapp.yml` copies the current `data/pack_data.json` and builds the webapp, then deploys
it on every push to `main`, or manually via "Run workflow". Since the webapp computes everything live from that
data, the deployed site is always in sync with `data/pack_data.json` at deploy time, with no separate ranking
generation step to keep up to date.

One-time repository setup: in **Settings → Pages**, set **Source** to **GitHub Actions**.
