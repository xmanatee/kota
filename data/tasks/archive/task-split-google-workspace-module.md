---
status: done
---

# Split google-workspace module into focused files

## Problem

`src/modules/google-workspace/index.ts` is 663 lines: tool schemas, API helpers, auth management, and token caching for three distinct Google services (Gmail, Calendar, Drive) are all packed into one file. This violates the 300-line file limit, makes the module hard to navigate, and breaks the single-concern principle. Each service is independent enough to own its own file.

## Desired Outcome

The google-workspace module directory contains focused files: one per service (`gmail.ts`, `calendar.ts`, `drive.ts`), a shared auth helper (`auth.ts`), and a thin `index.ts` that assembles the module. Each file stays under 300 lines. The module's external behavior and config schema are unchanged.

## Constraints

- No behavior changes: the same tools, the same config keys, the same guardrail risk classifications.
- Auth token caching logic belongs in a shared `auth.ts` — do not duplicate it.
- Update `docs/CONFIG.md` if any config key documentation moves.
- All existing tests pass after the split; add tests for any untested helpers that emerge.

## Done When

- `index.ts` is under 150 lines.
- Each service file (`gmail.ts`, `calendar.ts`, `drive.ts`) is under 300 lines.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, and `pnpm build` all pass.
