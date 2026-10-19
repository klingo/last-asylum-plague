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

The top nav groups the pages into menus (`NAV_GROUPS` in `webapp/src/nav.js`, the Home cards follow it): **Shop**
(Ranking, Spend Rewards, Best Choice Pick), **Events** (Calendar, Event Plan), **Items** (Item Priorities, Item Sources,
Compare) and **Heroes** (Gear Path).

- **Ranking** (`rankings.html`) — every package and pass on sale this week ranked by worth ÷ price, with what to buy
  ("Buy / week": how many the best plan for your exact weekly spend buys out of what's on sale; "in Weekly Pass" /
  "other pick" when a bundle or another member of its group is bought instead). "Plan only" shows just the weekly
  shopping list, the Type pills filter by kind; entries of unknown worth are listed unranked.
- **Calendar** (`calendar.html`) — the Event Schedule (recorded runs and a forecast, see below; each entry with the
  game's art, a hover card with how long is left, and a click opens its plan) and the Weekday Offers of the next 7
  days.
- **Events** (`events.html`) — one tab per ticked event (and the VIP Shop), with the event's banner and when it runs;
  its part of the same weekly plan: which event packs
  to buy, the coins they give, which shop offers to buy with them (in unlock order, incl. Encounters and bonus tiers),
  and a step table of how much spending more on the event still pays off.
- **Item Sources** (`sources.html`) — pick one item: every pack and shop offer on sale this week that gives it,
  nested at any depth (e.g. SR Resource Supplies → Herbs), ranked by Banknotes per unit, with how much each gives and
  an item ratio (worth of the item alone ÷ price).
- **Item Priorities** (`items.html`) — search every item and set its priority; shows its worth at your weekly spend.
- **Best Choice Pick** (`choices.html`) — the options of a choice chest, a package with options, or a group of
  packages you can only buy one of (`exclusive_group`, e.g. calendar packs), ranked by worth.
- **Compare** (`compare.html`) — two items with amounts: the worth of each, and the cheapest guaranteed way to get
  it within N days (crafting, choices and shops included; weekly limits reset on Monday).
- **Spend Rewards** (`spend-rewards.html`) — the track's banner and when it runs, and per tier of a spend track, what
  the extra Banknotes buy (the best packs
  still available at that total spend) plus the tier reward, as a step ratio: spend more while it's 1.0 or more.
- **Gear Path** (`gear.html`) — a squad (2 tanks in front, carries and support behind, each hero with its sword,
  armor, gauntlets and boots) and the guide to its UR gear in two phases: first crafting every piece, then two
  queues, one card each: the next level step and the next star step (star steps use Gear Blueprints, so you pick the
  one that fits what you have). A step that needs the other queue first says which one. A switch picks the hero
  faction (Warriors, Rangers, Warlocks: same path, other heroes); progress is saved in the browser, per faction. Data:
  `heroes` (rarity, faction, class, image), `gear_upgrades` (level caps by stars, minimum levels for stars,
  blueprints, optional cost tables) and `squad_guides` (formation, slots with a hero class and a hero per faction,
  `craft_path` / `level_path` /
  `star_path`) in `pack_data.json`; `verify-data` checks that the paths can be completed without a deadlock.

Weekly spend, events, seasonal passes on sale (e.g. the Gear Pass) and item priorities are shared by all pages
(saved in the browser). In the setup bar, events and passes the calendar shows running today carry a green dot, and
"Use this week's calendar" selects exactly those; the bar also shows what your last Banknote buys (hover it for the
explanation). Item names link to Item Sources, and the pages keep their selection in the URL (a reload or a shared
link opens the same item, event, track or comparison). On phones the tables drop their secondary columns. Item images:
drop a `<item_id>.png` into `webapp/public/assets/items/<category>/` (e.g. `items/chest/`; images not sorted yet are also found directly in `items/`, placeholder otherwise). Every item's `rarity`
(`mr`, `ur`, `ssr`, `sr`, `r`, or `null` for none) colours its image's border.

### Running locally

```bash
npm install                    # first time only (one package for everything)
npm run webapp:dev             # Vite dev server; the app imports data/pack_data.json directly
npm test                       # unit + golden tests of the valuation core (test/)
npm run verify-data            # validates pack_data.json (schema, references, deal % fit, items without a worth, code labels)
npm run i18n:missing -- de     # what German still lacks (UI texts, code labels, data names)
npm run record-run -- <ids...> [START] <DAYS>   # records when events / seasonal passes / spend tracks run (--show)
```

The code is split into `webapp/src/core/` (the valuation: pure modules without DOM, shared with the scripts and
tests), `webapp/src/ui/` (browser helpers) and `webapp/src/pages/` (one script per page).

`record-run` fills the `schedule` section of `pack_data.json`: per event, seasonal pass and spend reward track the
start and end date of each run, e.g. `npm run record-run -- strange_bazaar 2026-10-12 7` (start defaults to today;
the end is computed from the number of days). Recording the same start again corrects the length. Events without
packs (`"category": "ingame_event"` in `events`) can be tracked this way too. The Calendar page shows it as the Event
Schedule timeline (last week, this week, 4 weeks ahead) with a simple forecast: an entry recorded at least twice
repeats its usual rhythm (median days between starts, median length). Below it, Weekday Offers shows which
`weekly_rotation` packs are on sale today and in the next 6 days (from their `available_days`), each with the
image of its main item (the package's `icon`, else its first item other than diamonds, VIP points, alliance chests, ...).

### Deploying to GitHub Pages

`.github/workflows/deploy-webapp.yml` lints, tests and builds the webapp with the current `data/pack_data.json`, then
deploys it on every push to `master`, or manually via "Run workflow". Since the webapp computes everything live from that
data, the deployed site is always in sync with `data/pack_data.json` at deploy time.

One-time repository setup: in **Settings → Pages**, set **Source** to **GitHub Actions**.
