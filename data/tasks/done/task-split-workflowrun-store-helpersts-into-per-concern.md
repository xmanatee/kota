---
id: task-split-workflowrun-store-helpersts-into-per-concern
title: Split workflow/run-store-helpers.ts into per-concern sibling files
status: done
priority: p1
area: core
summary: Collapse src/core/workflow/run-store-helpers.ts (527 lines) into per-concern sibling files (state-schema validators, legacy migration, snapshot/summary helpers) so each file owns one concern, matching the per-phase split pattern that landed for the surrounding workflow-runtime cluster.
created_at: 2026-05-06T01:40:03.132Z
updated_at: 2026-05-06T01:51:29.244Z
---

## Problem

`src/core/workflow/run-store-helpers.ts` is the second-largest non-test
file in `src/core/workflow/` at 527 lines (largest is the pure-type
`types.ts` at 795). The file bundles three orthogonal concerns into one
declaration:

- Runtime-state schema validation: a stack of type-guard predicates
  (`isWorkflowRunStatus`, `isIsoString`, `isWorkflowRunRef`,
  `isWorkflowCompletion`, `isWorkflowStepSkipReason`,
  `isWorkflowAgentBackoffState`, `isWorkflowRunTrigger`,
  `isQueuedRunTrigger`, `isQueuedRun`, `isRetryAttempt`,
  `isWorkflowRecoveryState`, `isWorkflowCompletedQueuedPayload`,
  `isStringArray`, `assertWorkflowStepResult`) plus the public
  `assertWorkflowRuntimeState` and `assertWorkflowRunMetadata` (lines
  ~38–68 and ~155–430).
- Legacy migration of the pre-`{lastStarted, lastCompletion}` workflow
  state shape (`migrateLegacyWorkflowEntry`, `migrateLegacyWorkflowState`,
  lines ~70–152). This is transient migration code whose blast radius is
  unrelated to the runtime guards above; it just happens to be defined
  next to them today.
- Snapshot / summary helpers that serialize live workflow state for
  inspection (`summarizeStep`, `buildWorkflowSnapshot`,
  `extractRepairSummary`, the `RepairSummary` type, the
  `WorkflowSnapshot` type, lines ~24–32 and ~440–528, plus the
  `STATE_FILE` constant and the `ensureDir` / `formatRunId` /
  `safeJsonStringify` / `writeJsonFile` / `writeStrictJsonFile` re-exports
  that already point to `run-io.ts`).

The shape repeats the architectural-anchor pattern explorer keeps finding
across `src/core/`: one file accreting helpers from three different
migrations. A 2026-03-27 split already extracted IO utilities into
`run-io.ts`; the schema-vs-migration-vs-snapshot seam is the next
follow-up. The surrounding workflow runtime now has explicit per-concern
siblings (`runtime-config.ts`, `runtime-signals.ts`, `runtime-dispatch.ts`,
`runtime-lifecycle.ts`, `runtime-definitions.ts`, `runtime-runs-control.ts`,
`runtime-events.ts`, `runtime-recovery.ts`, `agent-backoff.ts`,
`schedule-triggers.ts`, `watch-triggers.ts`, `workflow-queue.ts`), so the
split landing place is established convention rather than a new pattern.

## Desired Outcome

`run-store-helpers.ts` is gone (or reduced to a re-export shim only if a
public-export migration is genuinely impractical for `run-store.ts`'s
current import surface). Three focused siblings own the concerns:

- `run-store-state-schema.ts` — the type-guard predicates plus
  `assertWorkflowRuntimeState` and `assertWorkflowRunMetadata`. This is
  the durable runtime contract.
- `run-store-legacy-migration.ts` — `migrateLegacyWorkflowEntry` and
  `migrateLegacyWorkflowState` (and any helpers used only by them). Kept
  isolated so its eventual removal does not touch the schema file.
- `run-store-snapshot.ts` — `summarizeStep`, `buildWorkflowSnapshot`,
  `extractRepairSummary`, `WorkflowSnapshot`, `RepairSummary`, plus the
  `STATE_FILE` constant.

`isPlainObject` lives in whichever sibling first uses it, exported only
when a second consumer needs it; do not keep a fourth shared file just
to host that one helper.

`run-store.ts` (and any other consumer) imports directly from the new
siblings; no second public surface stays behind. The existing `run-io.ts`
re-export trio in the current file is removed — consumers should import
from `run-io.ts` directly per the no-parallel-surfaces rule.

## Constraints

- One mechanism: continue the existing per-concern sibling-file pattern
  in `src/core/workflow/`. Do not introduce a new directory layer or a
  parallel registry.
- No backwards-compatibility re-export shim. Update every consumer of
  `run-store-helpers.js` to import from the new sibling that owns the
  symbol. Delete `run-store-helpers.ts` at the end of the change.
- Keep public export names unchanged (`assertWorkflowRuntimeState`,
  `assertWorkflowRunMetadata`, `migrateLegacyWorkflowState`,
  `buildWorkflowSnapshot`, `extractRepairSummary`, `WorkflowSnapshot`,
  `STATE_FILE`, `isPlainObject` if still public). The split is internal.
- The companion test file `run-store-helpers.test.ts` should follow the
  code: rename or split it to match the new owners (e.g.
  `run-store-state-schema.test.ts`, `run-store-legacy-migration.test.ts`,
  `run-store-snapshot.test.ts`) so each test file collocates with its
  subject. Per-concern coverage stays at parity; do not delete tests
  during the move.
- `src/strict-types-policy-baseline.json` may shift entries from
  `run-store-helpers.ts` to the new sibling files but must not gain net
  new `unknown` / `Record<string, unknown>` / `as unknown` usages.
- Update `src/core/workflow/AGENTS.md` to name the per-concern split
  convention for `run-store-*.ts` if it does not already (replace the
  existing run-store-helpers reference rather than appending — the file
  has limited budget).
- No test-only flags or hooks introduced just to make the split easier;
  use existing public APIs.

## Done When

- `src/core/workflow/run-store-helpers.ts` is deleted (or reduced to
  zero non-comment lines if a hard re-export constraint surfaces during
  implementation).
- `run-store-state-schema.ts`, `run-store-legacy-migration.ts`, and
  `run-store-snapshot.ts` exist with the symbol assignments described
  above; each stays well under 300 lines.
- All consumers (notably `run-store.ts`) import from the new siblings;
  `grep -r "from \"#core/workflow/run-store-helpers" src/` returns no
  matches, and `grep -r "from \"./run-store-helpers" src/` returns no
  matches.
- `pnpm typecheck` and `pnpm test` pass.
- `src/core/workflow/AGENTS.md` (or the closest applicable local
  `AGENTS.md`) names the per-concern run-store split convention.

## Source / Intent

Continuation of the architectural-anchor split cluster that landed
McpServer (841 → 197 via per-feature handlers), ModuleLoader (814 →
split via per-load-phase handlers), Daemon (666 → 215 via per-lifecycle
siblings), step-executor-agent (603 → 249 via per-phase siblings),
WorkflowRuntime (591 → split via per-lifecycle phases), and the daemon-
control unified route registry (commits 22f89e05, 70bffdf5, 28d13814,
c1e6b1f4, 3f5c0d44, 003e4cc3) on consecutive recent autonomy runs.
`run-store-helpers.ts` is now the largest remaining workflow-runtime
file and the next-largest non-test file in `src/core/workflow/` after
the pure-type `types.ts`. A 2026-03-27 split already extracted
`run-io.ts` from the same file; the schema-vs-migration-vs-snapshot
seam is the next clean follow-up.

## Initiative

Minimal-core / module-first architecture: shrink the largest core
files into focused per-concern siblings so each new workflow-runtime
migration has a clear landing seam instead of a monolith to grow.

## Acceptance Evidence

- `wc -l` recorded for `run-store-helpers.ts` (527) before and for
  each new sibling (each well under 300) after, captured in the commit
  message.
- New file list and per-symbol relocation captured in the commit
  message body.
- `pnpm typecheck` and `pnpm test` transcripts clean (covered by the
  builder repair-loop checks; the commit message references the
  validation gates that ran).
- `grep` search confirming `run-store-helpers` is no longer imported
  from `src/`.
- `src/core/workflow/AGENTS.md` (or the closest applicable local
  `AGENTS.md`) lists the per-concern run-store convention.
