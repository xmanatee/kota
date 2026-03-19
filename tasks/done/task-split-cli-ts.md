---
id: task-split-cli-ts
title: Split cli.ts — extract subcommand handlers from entry point
status: done
priority: p2
area: structure
summary: src/cli.ts is 449 lines, 50% over the 300-line limit. The file contains the CLI entry point plus all subcommand handler logic inline.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

`src/cli.ts` is 449 lines (50% over the 300-line limit). The CLI entry point mixes argument parsing, subcommand dispatch, and subcommand implementation logic in one file.

## Desired Outcome

`cli.ts` shrinks to ≤300 lines. A natural split is extracting subcommand handler implementations into one or more co-located modules (`cli-commands.ts` or per-command files), keeping `cli.ts` as a thin entry point and dispatcher.

## Constraints

- CLI behavior must be unchanged — same commands, options, and output.
- All tests must pass after the split.

## Done When

- `cli.ts` is ≤300 lines.
- Any extracted file is ≤300 lines.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` all pass.
