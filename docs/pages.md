The pages of the webapp, one by one. How the worth they show is calculated: [valuation.md](valuation.md); how to run and
change the project: the [README](../README.md).

# Pages

The top nav starts with **Today** (the home page) and **Calendar**, then groups the other pages into menus (`NAV_GROUPS` in
`webapp/src/ui/nav.js`; each page's short description is the `title` of its link: shown on hover, read out by
screen readers): **Shop** (Deal Ranking, Event Shops, Seasonal
Passes, Spend Rewards), **Items** (Item Sources, Best Pick, Compare Items, Item Priorities),
**Heroes** (Gear Upgrade Path) and **Lord** (Lord Specialty). The page files keep their names (`rankings.html`,
`events.html`, `gear.html`, ...), so saved links still work. The cogwheel next to the language switcher opens
**Settings** (`settings.html`) has three sections: **Valuation**, the settings that shape every value (Count VIP points
in the worth); **Notifications**, a switch for a browser notification when a new round of Survival Battle begins (every
4-hour slot of its rotation; switching it on asks the browser for permission, and as there is no server to push from, the
notification only comes while a tab of the app is open; while it is on, Today marks the Survival Battle bars with a bell); and **Model quality**, how well the fitted worths reproduce the
packs' deal %.

- **Today** (`index.html`) — what runs today (art, name, countdown, linking to its page) and what starts in the next 3
  days (recorded runs and proven forecasts), the weekly plan by when to buy it (daily packs, weekly and longer packs,
  weekday offers, each event's packs and how many different shop offers it buys, linking to its Event Shops tab) and
  today's weekday offers with their ratio, what the plan buys and what each gives (Details). Running entries are
  ordered by when they end; the countdown turns yellow in the last 24 hours, and a running event or pass shows what the
  plan buys from it.
  Survival Battle (`event_rotations` in `pack_data.json`: the 42 four-hour slots of its week, from Sunday's reset, the
  same every week) shows the phase on now and the next one, with their local times and how to earn points in them.

- **Deal Ranking** (`rankings.html`) — every package and pass on sale this week ranked by worth ÷ price, with what to buy
  ("Buy / week": how many the best plan for your exact weekly spend buys out of what's on sale; "in Weekly Pass" /
  "other pick" when a bundle or another member of its group is bought instead; "for the bonus tiers" when a pack below
  1.0 is bought because its coins reach an event shop's bonus tiers). "Plan only" shows just the weekly
  shopping list, the Type pills filter by kind; entries of unknown worth are listed unranked. A pack the plan
  buys has a small "Skip": the plan is made again without it (and without the higher tiers that need it), so the
  weekly spend is filled up with other packs, on every page. The row stays, faded, with Undo; a skip lasts until the
  weekly reset or until its event / pass is over, whichever comes first.
- **Calendar** (`calendar.html`) — the Event Schedule (recorded runs and a forecast, see [Schedule and forecasts](valuation.md#schedule-and-forecasts); each entry with the
  game's art, a hover card with how long is left, and a click opens its plan), the Weekday Offers of the next 7 days
  and, for each event rotation (Survival Battle), a chart of today and the next 6 days: one row per phase, a bar for
  each 4-hour slot (elapsed ones grey), a line for the phase on now, local times in the hover card. Every chart is on
  the user's local days: a bar starts and ends at the game's daily reset (02:00 UTC) in local time, so it can begin
  part-way into a day column. Banners, Today and the Deal Ranking's skips show the same local moments.
- **Event Shops** (`events.html`) — one tab per ticked event (and the VIP Shop), with the event's banner and when it runs;
  its part of the same weekly plan: which event packs
  to buy, the coins they give, which shop offers to buy with them (in unlock order, incl. Encounters and bonus tiers; an Encounter counts its random reward, the free one every day and
  the run's limit;
  you can enter extra diamonds per week to spend on them),
  and a step table of how much spending more on the event still pays off. A shop whose coin no pack gives (Thief Hunt's lion coins, earned by killing thieves) has an "Extra coins per week" field: you enter what you expect to earn, and the plan spends it on the best offers per coin. Dig events (Dwarven Mine, `mines` in
  `pack_data.json`) take the pickaxes you own and the floor you've reached; the plan counts the days left of the
  run (daily pack limits, 14 free pickaxes a day, +6 on days with a pack bought) and digs the floors in order at the
  expected digs per floor (`core/mine.js`). Unused pickaxes carry over to the next run but the floors don't, so it
  only digs a run that reaches the last progress reward (floor 100), and never past it (once there, the rest is saved
  for the next run). A verdict card on top says dig or not, with a floor track (floors cleared before, this run's
  floors or how far your pickaxes would reach) and the key numbers: the pickaxes still missing, what they'd cost and
  give, or that the packs can't give them in the days left. The digs are random, so you choose how sure to be (the
  exact distribution of a run's digs): the average ≈ 676 for floor 100 (enough in about 1 of 2 runs), 695 (9 in 10),
  710 (99 in 100) or the worst case 780 (the default, saved in the browser); the plan counts with your choice, and the
  card shows the chance your pickaxes suffice. The floor table also lists the floors above 100 (worth and ratio, never
  dug); Details lists a stretch's progress reward, the wish rewards and
  the expected tile loot; "How the mine works" lists the rules from the data. The
  pickaxe tile shows where they come from as a bar (owned, free, purchase bonus, each pack) and what's left for the
  next run. Extra Banknotes for an event are a cap: the plan only spends them where they buy at least what your last
  normal Banknote does.
- **Item Sources** (`sources.html`) — pick one item: every pack and shop offer on sale this week that gives it,
  nested at any depth (e.g. SR Resource Supplies → Herbs), ranked by Banknotes per unit, with how much each gives and
  an item ratio (worth of the item alone ÷ price).
- **Item Priorities** (`items.html`) — search every item and set its priority; shows its worth at your weekly spend.
- **Best Pick** (`choices.html`) — the options of a choice chest, a package with options, or a group of
  packages you can only buy one of (`exclusive_group`, e.g. calendar packs), ranked by worth.
- **Compare Items** (`compare.html`) — two items with amounts: the worth of each, and the cheapest guaranteed way to get
  it within N days (crafting, choices and shops included, with a shop's free coins; weekly limits reset on Monday).
- **Spend Rewards** (`spend-rewards.html`) — the track's banner and when it runs, and per tier of a spend track, what
  the extra Banknotes buy (the best packs
  still available at that total spend) plus the tier reward, as a step ratio: spend more while it's 1.0 or more.
- **Seasonal Passes** (`seasonal-passes.html`) — pick a seasonal pass (`?pass=<family id>`; the one running today is
  pre-selected, and the Calendar's pass bars link here): its banner and when it runs, its price, everything the
  whole pass gives (all tiers) with each item's worth, and the pass's worth against its price as a ratio, plus the
  tiers your weekly plan buys.
- **Gear Upgrade Path** (`gear.html`) — a squad (2 tanks in front, carries and support behind, each hero with its sword,
  armor, gauntlets and boots) and the guide to its UR gear in two phases: first crafting every piece, then two
  queues, one card each: the next level step and the next star step (star steps use Gear Blueprints, so you pick the
  one that fits what you have). A step that needs the other queue first says which one. A switch picks the hero
  faction (Warriors, Rangers, Warlocks: same path, other heroes); progress is saved in the browser, per faction. Data:
  `heroes` (rarity, faction, class, image), `gear_upgrades` (level caps by stars, minimum levels for stars,
  blueprints, optional cost tables) and `squad_guides` (formation, slots with a hero class and a hero per faction,
  `craft_path` / `level_path` /
  `star_path`) in `pack_data.json`; `verify-data` checks that the paths can be completed without a deadlock.
- **Lord Specialty** (`lord-specialty.html`) — a planner for the specialty skills of the two lords (Handyman, Legion
  Commander), drawn like the game's tree: Lv.1 at the bottom, a specialty skill left and right of every unlock level,
  hexagons for active ones, squares for passive ones. Left click adds a point, right click removes one, hovering shows
  what a specialty skill does (on a phone: tap adds, a long press removes). Above the tree you enter your level and
  extra Specialty Skill Points (saved in the browser): specialty skills above your level are grey and take no points
  (points they already have stay, with a red count, so lowering the level doesn't lose the build). The bar shows what
  the build requires ("Legion Commander: Lv.31", extra points only beyond the season's highest level), red while you
  can't have it yet, and your Specialty Points left. A preview switch shows the specialty skills of later seasons (Lv.45/50, greyed out). The lord and
  the build are in the URL (`?lord=&t=`, one digit per specialty skill), so a link shares the build; the browser also
  saves the lord and each lord's build (a shared link's build replaces yours only once you change it). Data:
  `data/lord_specialty.json` (its own schema, checked by `verify-data`; icons in `webapp/public/assets/lord/`).

Weekly spend, events, seasonal passes on sale (e.g. the Gear Pass) and item priorities are shared by all pages
(saved in the browser). In the setup bar, events and passes the calendar shows running today carry a green dot, and
"Follow the calendar" (on by default) switches to exactly those and keeps them up to date on every page load ("Following the
calendar" in the bar while it's on); selecting or unselecting an event or pass yourself turns it off; the bar also
shows what your last Banknote buys (hover it for the
explanation). Item names link to Item Sources, and the pages keep their selection in the URL (a reload or a shared
link opens the same item, event, track or comparison). On phones the tables drop their secondary columns. Item images:
drop a `<item_id>.png` into `webapp/public/assets/items/<category>/` (e.g. `items/chest/`; images not sorted yet are also found directly in `items/`, placeholder otherwise). Every item's `rarity`
(`mr`, `ur`, `ssr`, `sr`, `r`, or `null` for none) colours its image's border.
