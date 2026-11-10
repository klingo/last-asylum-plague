How the webapp turns the game's data into worths, and how it follows the event calendar. The pages that show the result:
[pages.md](pages.md).

# How worth is calculated

Almost every pack gives about one diamond per Banknote plus "bonus" items, so a pack's price can't be split across
its contents without a common value scale. The tool uses one:

- **Points** — every item has a relative worth in points (diamonds = 1). Nothing is hardcoded: base items are
  fitted live from the game's own deal percentages (every pack says what its contents are worth in diamonds;
  exchange-shop prices are used as weak extra hints), everything else is derived from what it contains (chests:
  expected contents, choice chests: best option, omni shards: the shard they replace, crafting chains: 4:1).
  Recipes (`crafted_from`, e.g. 800 UR Epigraph Shards → any UR Epigraph IV, 9 Lv.1 → 1 Lv.3 raven gear) cap an
  item at its crafting cost. Moon Coins and Star Moon Sigils are not modelled. Diamonds, event
  coins and dig-event pickaxes have no points of their own: they are worth what their shop offers buy (diamonds: the
  VIP shop) or what the floors they dig give.
- **Your priorities** — on the Item Priorities page each item is Don't care (0%), Low (50%), Normal (100%) or High
  (200%) of its worth; chests, choices and packs follow. VIP points, alliance chests, Top-Up EXP, Stamina and
  Direct Relocate start at Don't care. They still count in the fit (the game's deal % pays for them), so the rest of a
  pack isn't worth more for it. VIP points are the exception: by default ("Count VIP points in the worth" off on the
  Settings page, the cogwheel in the header) they're worth 0 in the fit too, so the other contents carry each pack's whole price, on every page;
  switched on, the worth follows the game's deal % for them as well.
- **Banknote worth** — one weekly optimisation (linear program, [HiGHS](https://highs.dev/) compiled to
  WebAssembly): the best purchases for your weekly Banknote spend within all purchase limits, passes and the events
  you tick. Worth = points ÷ what your last Banknote buys; diamonds and coins at what one more unit could still buy
  this week (at most what their best offer with room left gives, 0 once the shops are exhausted; a shop's bonus tiers
  don't raise it). A ratio of 1.0 or more = worth buying at your weekly spend.

## Schedule and forecasts

`record-run` fills the `schedule` section of `pack_data.json`: per event, seasonal pass and spend reward track the
start and end date of each run, e.g. `npm run record-run -- strange_bazaar 2026-10-12 7` (start defaults to today;
the end is computed from the number of days). Recording the same start again corrects the length. Only the last 12
runs of an id are kept, and a new run that lands on the id's proven pattern also records the pattern's runs missed in
between. Gameplay
events, those without packs (`"category": "ingame_event"` in `events`), can be tracked this way too. The Calendar page shows it as the Event
Schedule timeline (this week and the next three) with a simple forecast: an entry recorded at least twice
repeats its usual rhythm (median days between starts, median length). Once the gaps between its runs repeat (a proven
pattern) its forecast runs count as runs, also today and in the past (Follow the calendar, Running now, ...), so they
need no recording; 8 weeks after its last recorded run (two rounds, for a cycle longer than 4 weeks) it is a rough
guess again until its runs since then are recorded (`record-run --show` lists those). Below it, Weekday Offers shows which
`weekly_rotation` packs are on sale today and in the next 6 days (from their `available_days`), each with the
image of its main item (the package's `icon`, else its first item other than diamonds, VIP points, alliance chests, ...).
