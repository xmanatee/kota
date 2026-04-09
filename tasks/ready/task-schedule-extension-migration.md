---
id: task-schedule-extension-migration
title: Move schedule tool implementation into the scheduler extension directory
status: ready
priority: p2
area: architecture
summary: src/tools/schedule.ts contains the schedule tool implementation but is only imported by src/extensions/scheduler/index.ts. The file belongs inside the extension directory alongside the other scheduler code, completing the extension-first migration for this remaining case.
created_at: 2026-04-09T05:00:00Z
updated_at: 2026-04-09T05:18:19Z
---

## Problem

`src/tools/schedule.ts` holds the `scheduleTool` schema and `runSchedule`
runner. Its only non-test consumer is `src/extensions/scheduler/index.ts`,
which re-exports both to register the tool as a KotaExtension contribution.

This is the same pattern that `task-move-remaining-capability-tools-to-extensions`
resolved for `notify.ts`, `repo-map.ts`, and `tool-cache.ts`. That task
described three remaining files; `schedule.ts` was not included but follows
the identical pattern: capability implementation lives in core but is exclusively
owned by its extension.

`src/tools/AGENTS.md` is explicit: only agent-protocol and runtime-control
tools live in `src/tools/`; general-purpose capability packs belong in
`src/extensions/`. The schedule tool is a general-purpose capability (reminders
and event-based automations), not an agent-protocol primitive.

## Desired Outcome

`src/tools/schedule.ts` is moved to `src/extensions/scheduler/schedule.ts`.
`src/extensions/scheduler/index.ts` updates its import path accordingly.
No behavior changes.

## Constraints

- Only the file location changes; the tool name, schema, and runtime behavior
  are unchanged.
- All existing schedule-tool tests pass without modification (they test behavior,
  not file location).
- `src/extensions/scheduler/AGENTS.md` is updated to reference the new file.
- After the move, `src/tools/` contains no capability-pack files whose only
  consumer is a specific extension.

## Done When

- `src/tools/schedule.ts` no longer exists.
- `src/extensions/scheduler/schedule.ts` contains the moved code.
- `src/extensions/scheduler/index.ts` imports from `./schedule.js`.
- Build, typecheck, lint, and tests all pass.
