# Last Asylum Pack Solver

A small static webapp (in `webapp/`) that values items, packages and exchange-shop offers from
`data/pack_data.json` (Last Asylum: Plague), computed live in the browser and deployed to GitHub Pages.

## How worth is calculated

Almost every pack gives about one diamond per Banknote plus "bonus" items, so a pack's price can't be split across
its contents without a common value scale. The tool uses one:

- **Points** — every item has a relative worth in points (diamonds = 1). Nothing is hardcoded: base items are
  fitted live from the game's own deal percentages (every pack says what its contents are worth in diamonds;
  exchange-shop prices are used as weak extra hints), everything else is derived from what it contains (chests:
  expected contents, choice chests: best option, omni shards: the shard they replace, crafting chains: 4:1).
  Recipes (`crafted_from`, e.g. 800 UR Epigraph Shards → any UR Epigraph IV, 9 Lv.1 → 1 Lv.3 raven gear) cap an
  item at its crafting cost. Moon Coins and Star Moon Sigils are not modelled. Diamonds and event
  coins have no points of their own: they are worth what their shop offers buy (diamonds: the VIP shop).
- **Your priorities** — on the Item Priorities page each item is Don't care (0%), Low (50%), Normal (100%) or High
  (150%) of its worth; chests, choices and packs follow. VIP points, alliance chests, Top-Up EXP, Stamina and
  Direct Relocate start at Don't care.
- **Banknote worth** — one weekly optimisation (linear program, [HiGHS](https://highs.dev/) compiled to
  WebAssembly): the best purchases for your weekly Banknote spend within all purchase limits, passes and the events
  you tick. Worth = points ÷ what your last Banknote buys; diamonds and coins at what one more unit could still buy
  this week (0 once the shops are exhausted). A ratio of 1.0 or more = worth buying at your weekly spend.

## Pages

- **Ranking** (`rankings.html`) — every package and pass on sale this week ranked by worth ÷ price, with what to buy
  ("Buy / week": how many the best plan for your exact weekly spend buys out of what's on sale); entries of unknown
  worth are listed unranked.
- **Events** (`events.html`) — a ticked event's (or the VIP Shop's) part of the same weekly plan: which event packs
  to buy, the coins they give, which shop offers to buy with them (in unlock order, incl. Encounters and bonus tiers),
  and a step table of how much spending more on the event still pays off.
- **Item Priorities** (`items.html`) — search every item and set its priority; shows its worth at your weekly spend.
- **Best Choice Pick** (`choices.html`) — the options of a choice chest, a package with options, or a group of
  packages you can only buy one of (`exclusive_group`, e.g. calendar packs), ranked by worth.
- **Compare** (`compare.html`) — two items with amounts: the worth of each, and the cheapest guaranteed way to get
  it within N days (crafting, choices and shops included; weekly limits reset on Monday).
- **Spend Rewards** (`spend-rewards.html`) — per tier of a spend track, what the extra Banknotes buy (the best packs
  still available at that total spend) plus the tier reward, as a step ratio: spend more while it's 1.0 or more.

Weekly spend, events, seasonal passes on sale (e.g. the Gear Pass) and item priorities are shared by all pages
(saved in the browser). Item images:
drop a `<item_id>.png` into `webapp/public/assets/items/` (placeholder otherwise).

### Running locally

```bash
npm run webapp:install         # first time only
npm run webapp:dev             # copies data/pack_data.json into webapp/public/data, starts the Vite dev server
npm run verify-data            # validates pack_data.json (schema, references, deal % fit, items without a worth)
```

### Deploying to GitHub Pages

`.github/workflows/deploy-webapp.yml` copies the current `data/pack_data.json` and builds the webapp, then deploys
it on every push to `master`, or manually via "Run workflow". Since the webapp computes everything live from that
data, the deployed site is always in sync with `data/pack_data.json` at deploy time.

One-time repository setup: in **Settings → Pages**, set **Source** to **GitHub Actions**.
