# Simplification plan: 5 pages, 1 model, priorities

> Written 2026-10-03 after the review-followup work (`docs/review-followup-plan.md`). You found the app too
> complicated. Decisions below are yours.
>
> Status (2026-10-03): **implemented, not committed.** Notes from the implementation:
> - **Spend Rewards' tier totals are what the plan actually spends to reach each tier.** The track's cheapest
>   cost assumes 99-Banknote top-ups the plan never buys, so solving at that budget fell just short of every
>   threshold.
> - **Item names are HTML-escaped now.** Names like "<Hero> Shard" used to show as "Shard".
> - **The Needs Planner engine lives on in Compare** (`acquire.js`). Its page, Analyze, Item Worth and the
>   Weekly Planner page are deleted, as are the Simple model and the multi-select control.

## Decisions
- **One model:** the weekly-budget model (`planner.js`, HiGHS).
  - Input: one "Weekly Banknote spend" field, plus the events (and spend tracks) running this week.
  - Worth of an item = points ÷ λ, the points your last Banknote buys at that spend. Diamonds and coins count
    at what they can still buy.
  - The Simple model, the variant switch, and the Passes / Once-only toggles go away. Passes always count;
    once-only packs don't count toward the weekly market but are still listed (as "once").
- **Priorities instead of ignore list, weights and fit corrections.**
  - Levels: Don't care = 0%, Low = 50%, Normal = 100% (default), High = 200%.
  - They become the existing post-fit weights (`itemWeights`), so they flow into every chest, choice and pack
    value.
  - The 10 default "worthless" items start at "Don't care". Existing browser settings are migrated (ignored →
    Don't care, weights → nearest level).
- **Pages:**
  1. **Ranking:** all packages/passes/event packs (optionally exchange offers) with price, per-week capacity,
     worth and ratio. Ratio ≥ 1 = worth buying at your spend. Events are switched on/off on the page.
  2. **My Items:** every item with a search box and a Don't care / Low / Normal / High selector. It's wide,
     can show only the items you've changed, and shows each item's worth and an "uncertain" hint.
  3. **Best Choice Pick:** as today, plus "pick one" groups (`exclusive_group`, e.g. the 4 Calendar Gifts),
     ranked by worth vs. price.
  4. **Compare:** two items with amounts.
     - Shows the worth of each side.
     - Shows the cheapest Banknotes to obtain each side within N days from today (the `acquire.js` engine:
       guaranteed sources, crafting, choices, shops), with the purchases.
  5. **Spend Rewards:** for a spend track, per tier, the step's extra Banknotes vs. what they buy at that total
     spend. That means the best remaining packs (a weekly plan solved at the tier's total) plus the tier
     reward, as a ratio on the same scale. Keep spending while ≥ 1; stop where it drops below.
- **Deleted:** Item Worth, Weekly Planner, Needs Planner and Analyze pages, the Simple model module, and
  the code only they used. Git history keeps them.

## Order of work
1. settings (priorities + migration), valuation (single model), panel (budget / events / tracks).
2. Ranking, Best Choice Pick (+ groups), Spend Rewards (tier steps via plans).
3. New My Items and Compare pages; delete the old pages; nav, welcome page, vite inputs.
4. Prune unused i18n keys; docs (README, CLAUDE.md), memory; verify-data / lint / build; browser check with
   your settings backed up and restored.
