# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Last Asylum Pack Solver

CLI scripts and a static webapp that analyze packages/exchange shops from `data/pack_data.json` (mobile game
"Last Asylum: Plague"). Both compute the same purchase-value logic live; the webapp deploys to GitHub Pages.

## Scope Discipline

- Prefer the smallest change that solves the stated problem. Do not add new schema sections, sync scripts, npm
  commands, or lint-staged wiring unless asked.
- If you think a larger refactor is warranted, describe it in one paragraph and wait for approval before editing
  files.
- When the user proposes a data-structure design, implement it as described. Raise concerns once, then defer to
  the user's decision.

## Git Safety

- NEVER create branches, push to remote, or open PRs unless explicitly asked. Work on the current branch and stop
  after committing locally.
- Never downgrade dependency or GitHub Action versions to "fix" a problem. If a version looks wrong, ask first.

## Commands

```bash
npm run verify-data                                          # validate data/pack_data.json against its schema
npm run lint                                                  # eslint .
npm run analyze-item-value -- <item_id> [target_quantity]     # note the `--`
npm run webapp:dev                                             # copy-pack-data + vite dev server
npm run webapp:build                                           # copy-pack-data + vite build -> webapp/dist
```

No test suite exists in this repo.

## Project Structure

```
data/pack_data.json               # source of truth, schema-validated by data/pack_data.schema.json
scripts/lib/pricing.js            # CLI (CommonJS): pricing/yield resolution + package-tier expansion
webapp/src/lib/pricing-core.js    # browser (ESM) port of pricing.js — mirrored by hand, not shared
webapp/src/lib/data.js            # mirrors pricing.js's tier expansion for the webapp
webapp/src/lib/purchase-plan.js   # mirrors scripts/analyze-item-value.js
webapp/src/lib/ranking-core.js    # computes rankings live; mirrors the shape of the retired output/value_ranking.json
webapp/src/i18n/{en,de}.json      # de.json values are intentionally blank placeholders, not missing data
```

The CLI is CommonJS/Node; the webapp is ESM and browser-only (no `fs`/`path`) — that split is why the pricing/yield
logic above is duplicated instead of shared, and why the webapp computes everything live from `pack_data.json`
rather than reading a pre-generated ranking file.

## Conventions

- Changing pricing/yield/tier-expansion logic: update both the `scripts/lib/` and matching `webapp/src/lib/` file.
- `data/pack_data.json` is auto-processed on commit (husky + lint-staged): sort → update-last-updated → prettier.
- Don't fill in `de.json` blanks unless asked to.

## Formatting Conventions

- Numbers in tables: thousand separators, right-aligned, consistent decimal padding.
- Item/package names on ranking pages include the tier suffix.

## Reference Documents

- `README.md` — CLI usage, webapp pages, GitHub Pages deployment.
- `data/pack_data.schema.json` — full shape of `pack_data.json`.
