---
id: task-workflow-file-watch-trigger
title: Add file-watch trigger type to workflow definitions
status: done
priority: p3
area: runtime
summary: Workflows can only trigger on bus events, cron schedules, intervals, or webhooks. A file-watch trigger would let operators react to file system changes — running tests when source files change, or kicking off a builder pass when a diff lands.
created_at: 2026-03-31T13:03:00Z
updated_at: 2026-04-01T06:30:00Z
---

## Problem

`WorkflowTriggerInput` in `src/core/workflow/types.ts` supports `event`, `schedule`, `intervalMs`, and `webhook` triggers. There is no way to trigger a workflow when a file or directory changes. KOTA already has a `file-watch` tool and a `FileWatcher` class (`src/file-watcher.ts`) — but these are session-scoped tools, not trigger-level primitives. Operators who want to run a workflow whenever a file changes must poll via interval or wire an external watch process.

## Desired Outcome

A `watch` field on `WorkflowTriggerInput` that accepts a glob pattern (or array of patterns) and a debounce duration. When matching files change, the workflow is queued with a `files.changed` event payload listing the affected paths.

Example definition:

```ts
triggers: [{ watch: "src/**/*.ts", debounceMs: 1000 }]
```

The daemon's `ScheduleTriggerManager` (or a new `WatchTriggerManager`) registers the watch on daemon start and fires the trigger when changes are detected.

## Constraints

- File watching must use `fs.watch` or an equivalent low-overhead mechanism — do not add a new npm dependency.
- Debounce is required; minimum debounce of 200ms enforced.
- Watch triggers are only active when the daemon is running; they are silently skipped in standalone CLI mode.
- The trigger payload must include the list of changed file paths so workflow steps can use them.
- Validate the glob pattern at workflow definition load time; reject definitions with invalid patterns.

## Done When

- `WorkflowTriggerInput` accepts a `watch` field.
- The daemon activates file watches on startup for all workflows with watch triggers.
- When matching files change, the workflow is queued with a `files.changed` event payload.
- Workflow validation rejects definitions with missing or invalid watch patterns.
- At least one unit test verifies trigger firing on file change.
