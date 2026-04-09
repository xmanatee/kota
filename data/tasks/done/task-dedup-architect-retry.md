---
id: task-dedup-architect-retry
title: Deduplicate STREAM_MAX_RETRIES/streamBackoff in architect module
status: done
priority: p3
area: refactor
summary: architect.ts exports STREAM_MAX_RETRIES and streamBackoff that nobody outside the directory imports, and architect-editor.ts duplicates private copies of both. Extract to src/architect/retry.ts so both files share one definition.
created_at: 2026-03-27T12:50:00Z
updated_at: 2026-03-30T20:54:00Z
---

## Problem

After the architect.ts split, `STREAM_MAX_RETRIES = 2` and `streamBackoff` appear twice in the architect directory:

- `architect.ts` — exported (but imported by no file outside `src/architect/`)
- `architect-editor.ts` — private duplicate (added to avoid test mock issues)

The duplication was introduced because `architect-editor.ts` could not safely import from `architect.ts` — `runner.test.ts` mocks the entire `./architect.js` module, which would shadow those exports.

## Desired Outcome

Extract a new `src/architect/retry.ts` containing only:
- `export const STREAM_MAX_RETRIES = 2`
- `export function streamBackoff(attempt: number): Promise<void>`

Both `architect.ts` and `architect-editor.ts` import from `./retry.js`. Remove the now-redundant private copy in `architect-editor.ts` and the now-unnecessary exports from `architect.ts`.

## Constraints

- No behaviour changes — only restructuring.
- Keep the same retry values (RETRIES=2, same backoff formula).
- Update `src/architect/AGENTS.md` to add `retry.ts` to Key Modules.
- Keep this as low-priority cleanup unless the duplication starts blocking more meaningful architecture or capability work.

## Done When

- `src/architect/retry.ts` exists with `STREAM_MAX_RETRIES` and `streamBackoff`
- `architect.ts` imports both from `./retry.js` (no longer defines them)
- `architect-editor.ts` imports both from `./retry.js` (no private duplicate)
- All tests pass
