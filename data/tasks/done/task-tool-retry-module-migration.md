---
id: task-tool-retry-module-migration
title: Move tool-retry.ts implementation into its owning module
status: done
priority: p2
area: architecture
summary: src/tool-retry.ts is the implementation for the tool-retry module, but it lives in the core root because delegate-turn.ts imports maybeRetry directly. Removing that direct import and routing delegate retries through the middleware system would let the implementation move into src/modules/tool-retry/, completing the capability pack migration.
created_at: 2026-04-09T04:20:00Z
updated_at: 2026-04-09T05:40:00Z
---

## Problem

`src/tool-retry.ts` is the actual retry middleware implementation. Its module wrapper at `src/modules/tool-retry/index.ts` is a thin shell that just imports from the core root. This is the last tool-level capability implementation stranded in `src/` root — `task-move-remaining-capability-tools-to-modules` cleaned up `tool-cache.ts`, `notify.ts`, and `repo-map.ts` yesterday, but explicitly excluded `tool-retry.ts` because `src/tools/delegate-turn.ts` imports `maybeRetry` directly:

```ts
// delegate-turn.ts line 7
import { maybeRetry } from "../tool-retry.js";
```

This direct import creates a core → implementation dependency that prevents moving the file. The `maybeRetry` call in `delegate-turn.ts` retries tool calls made by sub-agents. That retry behavior is correct, but it bypasses the middleware chain rather than flowing through it.

## Desired Outcome

- `src/tools/delegate-turn.ts` no longer imports from `../tool-retry.js`.
- Delegate tool execution routes through the registered middleware chain (the retry middleware, if loaded, handles delegate retries automatically).
- `src/tool-retry.ts` is moved to `src/modules/tool-retry/tool-retry.ts` (or similar co-located path).
- `src/modules/tool-retry/index.ts` imports from its local path instead of `../../tool-retry.js`.
- The old `src/tool-retry.ts` is deleted.
- All existing retry behavior for delegate sub-agent tool calls is preserved.

## Constraints

- No change to external retry behavior. The tool-retry module must still apply to tools run through delegates.
- All tests pass; co-locate any moved tests alongside the new module file.
- Do not modify the `KotaModule` interface or middleware protocol.
- Verify that the middleware chain is invoked for delegate tool calls after the change (existing tests or a new test is sufficient).

## Done When

- `src/tool-retry.ts` no longer exists.
- `src/modules/tool-retry/` contains the full retry implementation.
- `src/tools/delegate-turn.ts` has no import from `tool-retry`.
- All tests pass with no behavior regressions.
