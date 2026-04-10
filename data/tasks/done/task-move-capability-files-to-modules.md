---
id: task-move-capability-files-to-modules
title: Move capability utility files from src/ root into owning modules
status: done
priority: p1
area: architecture
summary: src/repo-tasks.ts, src/task-queue-validation.ts, src/workflow-history.ts, and src/workflow-logs.ts are capability code pooling in the core src/ directory rather than in their owning modules. Moving them continues the module-first migration and shrinks the core.
created_at: 2026-04-10T09:20:00Z
updated_at: 2026-04-10T09:20:00Z
---

## Problem

Four capability files live directly in `src/` alongside core protocol and loop code:

- `src/repo-tasks.ts` — task file reading and mutation helpers owned by the `repo-tasks` module
- `src/task-queue-validation.ts` — task queue structure validation, also owned by `repo-tasks`
- `src/workflow-history.ts` — workflow run metadata helpers owned by the `workflow` module
- `src/workflow-logs.ts` — workflow step log reading/writing owned by the `workflow` module

Their natural owners (`src/modules/repo-tasks/` and `src/modules/workflow-ops/`) already import these files. The files remain in core only by inertia; no core protocol or loop primitive requires them there. This is the same pooling pattern that route and CLI migration tasks have steadily cleared.

## Desired Outcome

- Each file lives inside its owning module directory.
- All existing importers updated to use the new paths.
- No exported surface changes visible to callers (re-export from the module's `index.ts` where cross-module access is needed, or route through the `TaskProvider` / workflow module interfaces).
- `src/validate-queue.ts` (the thin CLI wrapper around `task-queue-validation.ts`) moves or stays in place accordingly.
- The `src/AGENTS.md` key-module table updated to remove these entries.

## Constraints

- Do not change any exported function or type signatures.
- Cross-module consumers (web-ui, mcp, scheduler, autonomy workflows) that import directly from the core path must import from the module path or from a re-export; do not create circular imports.
- Do not move files that are genuinely core (loop, transport, guardrails, event bus, module protocol types).

## Done When

- `src/repo-tasks.ts` and `src/task-queue-validation.ts` are absent from `src/` root and present under `src/modules/repo-tasks/`.
- `src/workflow-history.ts` and `src/workflow-logs.ts` are absent from `src/` root and present under `src/modules/workflow-ops/`.
- `tsc --noEmit` passes with no new errors.
- All existing tests pass.
- `src/AGENTS.md` updated.
