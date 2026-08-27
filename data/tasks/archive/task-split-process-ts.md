---
status: done
---

# Split src/core/tools/process.ts — 339 lines, over limit

## Problem

`src/core/tools/process.ts` is 339 lines, exceeding the 300-line limit in AGENTS.md.

## Desired Outcome

The file is split into two or more co-located modules, each under 300 lines.

## Constraints

- No behavior change — all tests must pass.
- Follow the established split pattern (co-located helper module).

## Done When

- `process.ts` is under 300 lines.
- Extracted logic lives in a co-located helper file.
- All tests pass.
