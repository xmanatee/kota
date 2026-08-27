---
status: done
---

# Split src/core/tools/file-read.ts — over 300-line limit

## Problem

`src/core/tools/file-read.ts` was 303 lines, just over the 300-line limit defined in AGENTS.md.

## Desired Outcome

The file is split into two co-located modules, each under 300 lines.

## Constraints

- No behavior change — all tests must pass.
- Follow the established split pattern (co-located helper module).

## Done When

- `file-read.ts` is under 300 lines.
- `file-read-formats.ts` contains the format detection logic and per-format readers.
- All tests pass.
