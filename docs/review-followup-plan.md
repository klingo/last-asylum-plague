# Follow-up plan: review fixes + Needs Planner

> Written 2026-10-03 after the review of the valuation rework (see `docs/valuation-rework-plan.md`).
> Status (2026-10-03): **implemented, not committed.** Changes against the plan:
> - **Spend tracks keep no `event_id`.** The schema calls them independent of events on purpose, so a
>   "Spend tracks this week" setting (`activeTracks`) switches them on instead.
> - **Raven gear is modelled per type.**
>   - Lv.1/Lv.3 items exist for each of the 6 types; the Lv.1/Lv.3 chests are random 1/6 over them.
>   - Recipes: Lv.3 = 9× Lv.1, Lv.5 = 9× Lv.3 (3:1 per level). The Lv.5 items were renamed "Lv.5 …".
> - **Recipes in the fit are a strong cap plus a weak two-sided hint.** A one-sided cap alone let Lv.1 gear
>   outprice Lv.3.
> - **The by-product tie-break keeps the cheapest plan's shop purchases.** It no longer "spends leftover
>   currency".
> - **Calendar packs:** the 4 Calendar Gift packs were added by you (group `calendar_gift`, 30 days). The
>   event name is still a placeholder.

## Context
The review found that:
- **Analyze**'s exact cheapest-plan MILP is the most trustworthy part of the tool;
- **Rankings** and the **Planner** rank packs robustly by "game value minus junk", but know nothing about
  the user's own needs;
- several outputs are wrong or misleading:
  - zero-cost shop purchases appear in plans;
  - random chests count at expected value;
  - once-only packs are always available in Analyze;
  - unknown packs are ranked as bad;
  - spend and bonus tiers are framed as purchases;
  - the "uncertain" flag misses single-pack dependence.

You asked for all five recommended changes, plus a **Needs Planner**:
- enter the items and amounts you need (and what you already own);
- get the most cost-effective way to obtain them, both quickly and cheaply;
- get advice on which choice-chest options to take;
- get advice on which pack of a "pick one" group (e.g. 5 calendar packs) fits you best.

## Facts and decisions from you (2026-10-03)
- **800 UR Epigraph Shards** give **any UR Epigraph IV of your choice**. You get the epigraph directly, not the
  choice chest.
- **Calendar packs**:
  - you buy one once and receive rewards **every day for N days**;
  - only **one of the ~5** can be bought per event/period.
- **Weekly limits reset on Monday** (server time); daily limits reset at the start of each day.
- **Random chests count toward needs only when you allow it.** By default, needs are met only from
  guaranteed sources. Random chests still count as by-products, and a toggle allows expected values,
  showing the chance of success.
- **"As quickly as possible"** is a **time-vs-cost table**: the cost for several horizons. Clicking a row
  shows its detailed plan.

## Data and schema additions (needed by the features; all optional fields)
| Field | Where | Meaning |
|---|---|---|
| `crafted_from: {itemId: qty}` | items | Can be crafted from these ingredients. Set on the 12 `*_iv_*` epigraph items: `{ "ur_epigraph_shard": 800 }`. |
| `delivery_days: N` | packages (and tiers) | `contains` is the total delivered over N days. It generalizes today's pass rule (weekly 7, monthly 30); passes keep their category fallback. |
| `exclusive_group: "<id>"` | packages | At most one package of the same group can be bought (per event run, or per week without an event). Used for calendar packs. |
| `event_id` | spend_reward_tracks | The track only counts while its event is active (Ancient Recipe → a new `events` entry). |

`verify-data` checks:
- `crafted_from` references resolve;
- every `exclusive_group` has ≥ 2 members sharing the same event/limit type;
- `delivery_days ≥ 1`;
- every track's `event_id` exists.

The raven-gear 3:1 chain stays `value_equivalent` (valuation only) unless you want it as `crafted_from` too.

## 1. Analyze fixes (shared engine in `webapp/src/lib/acquire.js`)
- **No spurious shop purchases.** Give exchange offers the same tiny objective cost as conversions
  (`CONVERSION_COST`).
- **Once-only toggle.** `packageCapacityForDays` honours `includeExclusives` the same way
  `packageWeeklyCapacity` does. Add `'exclusives'` to Analyze's panel fields.
- **Random drops.**
  - Default: opening random chests can't satisfy a need; the chests stay as by-products.
  - With "Count random drops (expected)": the plan shows the success chance. Use the binomial chance
    when the target comes from one drop entry; otherwise say "expected value only".
- **Whole picks.** Choice picks (package `pc` and choice-item `pick` variables) become integers.
  Random `open` stays continuous (an expectation).
- **Crafting.** `crafted_from` becomes a conversion (consume the ingredients, produce 1), so 800 shards → the
  chosen epigraph.
- **By-products as tie-breaker.**
  - Pass 1 minimizes Banknotes.
  - Pass 2 fixes cost ≤ the minimum and maximizes the worth of what's left over (selected model).
  - Result: equally cheap plans prefer valuable extras, and unneeded choice picks go to the best option.
- **Weekday-aware horizon.**
  - New "Start day" input (default: today) instead of "days from an abstract day".
  - Daily packs count only their `available_days` inside the window.
  - Weekly limits count the Monday-based weeks the window touches.
  - Calendar/pass contents count the delivered share for the days inside the window.

## 2. Presentation fixes
- **Rankings.** Entries with unknown worth (Moon Coin / Surprise Encounter packs, anything incomplete)
  leave the ranked list. They go into a separate "Worth unknown" group without rank or ratio.
- **Spend Rewards and shop bonus tiers are shown as bonuses, not purchases.**
  - Show "+X% bonus on the step's Banknotes" (reward worth ÷ step cost), with a note that the Banknotes
    also buy packs.
  - Bonus tiers leave the ranked list in Rankings and get their own "Bonus while spending coins" section.
- **Item Worth wording.**
  - The scale sentence becomes "1 point ≈ one diamond in the game's deal %". The Diamonds row explains that
    currencies show what they buy.
  - The override column is renamed "Correct fit (points)", with a tooltip: "the other items in the same packs
    adjust; to value an item less for yourself, use My weight" (see 4).

## 3. Single-pack dependence (fit sensitivity)
- **`fitSensitivity(data, overrides)` in `point-fit.js`.** It refits once per package family left out (~85
  refits). Each refit warm-starts from the full fit's values (a new optional `initial` argument), so the
  total is about 1–3 s.
  - Per item it returns `{ factor, pack }`: the largest change and the pack causing it.
- **Uncertain flag** = log standard error > 0.5 **or** leave-one-out factor > 1.5. The tooltip names the
  reason, e.g. "×5.2 without Building Speedup Pack".
- **Item Worth page.** It runs after the first render, in chunks (`setTimeout` between refits), and updates the
  flags when done. Results are cached per data + overrides.
- **verify-data** lists the items with factor > 1.5.

## 4. My weight (personal preference, separate from fit corrections)
- **New setting `itemWeights: {itemId: factor}`** (0–5, default 1). `resolveItemValues` multiplies an item's
  resolved value by its weight. `ignored` is the same as weight 0; the "Treat as worthless" control stays
  as a shortcut.
- Containers pick up weighted contents automatically. A weight on a container multiplies on top.
- Unlike fit corrections, weights act **after** the fit. "SSR Curio matters less to me" therefore lowers the
  Curio Pack.
- **Item Worth page:** a "My weight %" column. It applies on every page through `buildValuation`, and is
  included in the fit cache key only via overrides, not weights.

## 5. Planner, Rankings and Analyze completeness
- **Spend track in the Weekly Planner.**
  - Each track whose event is active adds a binary per tier: track points earned ≥ threshold × binary.
    Track points per package come from the track's `conversions` (points per Banknote; price + 1 in the
    current data).
  - The objective gains the tier reward's points. Same pattern as the shop bonus tiers
    (`planner.js:153-171`).
- **Rankings capacity column.** "Per week" = Banknotes you can spend on that entry per week
  (capacity × price; "unlimited" for top-ups). For exchange offers: capacity × coin cost.
- **Analyze: weekdays.** Covered by the start-day input from 1.

## 6. Needs Planner (new page `needs.html` + `src/needs.js`)
### Engine (generalized `acquire.js`, shared with Analyze)
`solveNeeds(highs, data, { needs: Map<itemId, qty>, inventory: Map<itemId, qty>, startDay, days, activeEventIds, includeExclusives, exceedEventPackLimits, countRandom, forced: Map<pkgId, count>, worthOf })`

- **Balance rows:** produced + owned − consumed ≥ needed (0 for everything else).
  - Owned choice chests and random/fixed chests enter as inventory. The solver decides which option to pick
    and whether to open them.
- **`exclusive_group`:** the sum over a group's packages ≤ 1 (per event run, or per Monday week).
- **Objective:** the two-pass minimum cost, then the by-product worth tie-breaker (from 1).
- Analyze's plan becomes `solveNeeds` with a single need. Its sources table is unchanged.

### Page
- **Inputs** (stored in localStorage, like the valuation settings):
  - **Needs:** an item picker plus quantity rows (reuse `item-picker.js`);
  - **Owned:** item and quantity rows, e.g. "I have 1 UR Epigraph Choice Chest, 1,600 shards";
  - start day, toggles (count random drops, once-only packs) and the shared valuation panel (events,
    model).
- **Time-vs-cost table:**
  - solve for horizons of today, 3, 7, 14, 21, 28, 42 and 56 days (stop early once the cost stops
    dropping);
  - columns: Banknotes, by-product worth, net, and the "reachable?" status;
  - the cheapest and the fastest reachable rows are highlighted;
  - clicking a row shows its plan.
- **Plan detail:**
  - purchases (with day/week where the limit matters) and shop exchanges;
  - crafting ("Craft Frenzied Flock IV from 800 shards");
  - **choice recommendations**: "From UR Epigraph Choice Chest pick Frenzied Flock IV" (for needs) or the
    best-worth option (by-products), covering bought and owned chests;
  - leftovers with their worth.
- **"Pick one" advisor.** One per `exclusive_group` with an active event (e.g. the 5 calendar packs).
  - For each member, solve with it forced (`forced = {pkg: 1}`) and compare against "none of the group"
    for the selected horizon.
  - Shown: your saving on the needs (Banknotes not spent elsewhere), the worth of its extras, and the net.
    Members ranked by net, with a "best for you" mark.
  - Without needs entered, it falls back to worth ÷ price (as in Rankings).
- Nav link, vite `input` entry, i18n (`en.json`; blank `de.json` placeholders).

## Order of work
Each step is verifiable on its own; I stop after each step marked with a checkpoint.
1. **Data/schema:** the 4 fields, the epigraph recipes, verify-data checks. The calendar packs themselves
   come from you: tell me their contents/days/price, or add them.
2. **Engine:** `acquire.js` generalization, plus all the Analyze fixes (section 1). **Checkpoint:** Node runs
   of the review cases: 1 Frenzied Flock IV now uses shards; there are no stray shop purchases; once-only
   packs follow the toggle; the random-drop toggle works.
3. **Presentation fixes** (section 2) and **fit sensitivity** (section 3).
4. **My weight** (section 4).
5. **Spend track in the Planner**, plus the Rankings capacity column (section 5).
6. **Needs Planner page** (section 6). **Checkpoint:** a browser walkthrough with you.
7. Docs (README pages list, CLAUDE.md structure and valuation section), memory, and the review copy.
   Then `verify-data`, `lint` and `webapp:build`.

No commits unless asked.

## Verification
- `npm run verify-data` (new checks pass), `npm run lint` (no new warnings beyond the script logging),
  `npm run webapp:build`.
- **Node checks:**
  - **Analyze:** 1 `frenzied_flock_iv_ranger` uses shards plus crafting; with the toggle off, no random
    chest satisfies a need; with it on, a success chance is shown.
  - **Analyze:** no exchange offers in plans unless they feed a need; with "Once-only" off, no
    `unlock_exclusive` packs appear; all picks are whole numbers.
  - **Needs:** owning 800 shards makes the epigraph cost 0. The horizon table never gets more expensive
    as the horizon grows, and the cost is monotone.
  - **Exclusive group** (a test group): at most one member is bought, and the advisor's savings match the
    difference between the two solves.
  - **Planner:** with the Ancient Recipe event active, total points ≥ the result without it, and tiers are
    only reached when spend ≥ threshold.
  - **Weights:** weight 0.5 on `ssr_curio` lowers `curio_pack_t1`'s ratio; weight 0 equals ignored.
- **Browser** (`npm run webapp:dev` + claude-in-chrome, settings backed up and restored):
  - every page loads;
  - the Needs Planner works end to end on a sample (UR hero shards + one epigraph + owned shards);
  - the pick-one advisor works on a test group;
  - Rankings shows the unknown group and the capacity column;
  - Spend Rewards shows bonus %.
