---
status: done
---

# Security review: Workflow run IDs accepted from queued or event trigger payloads are not path-safe before being used as a directory name. A top-level `_runId` in a workflow-triggering event can become the queued run id, and `createRun` only rejects empty strings before joining it under `.kota/runs`, so path separators can redirect workflow artifact writes outside the run directory.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/workflow/run-store.ts
claim:

> Workflow run IDs accepted from queued or event trigger payloads are not path-safe before being used as a directory name. A top-level `_runId` in a workflow-triggering event can become the queued run id, and `createRun` only rejects empty strings before joining it under `.kota/runs`, so path separators can redirect workflow artifact writes outside the run directory.

## Desired Outcome

> Reject `_runId` from arbitrary event payloads, centralize run-id validation to a path-safe allowlist, reject `..` and path separators for both explicit `runId` and payload `_runId`, and add tests covering event-queued and store-created traversal attempts.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-20T15-28-10-451Z-security-review-9efs0g.

finding id: security-review-2026-06-20-run-id-path-traversal
candidate id: task-workflow-mutation:src/core/workflow/run-store.ts:357
verdict: confirmed
rationale:

> Event-triggered payloads are cloned without stripping `_runId` (`src/core/workflow/run-executor-utils.ts:327`), the queue adopts payload `_runId` as `runId` (`src/core/workflow/workflow-queue.ts:135`), and dispatch passes it into `createRun` (`src/core/workflow/runtime-dispatch.ts:127`). `createRun` only rejects blank explicit ids and writes under `join(this.runsDir, id)` (`src/core/workflow/run-store.ts:351`, `src/core/workflow/run-store.ts:359`), so `..` or path separators can redirect run artifacts outside `.kota/runs`.

Evidence:

Evidence 1:

path: src/core/workflow/run-executor-utils.ts

line: 327

excerpt:

> payload: cloneTriggerPayload(envelope.payload),

Evidence 2:

path: src/core/workflow/workflow-queue.ts

line: 135

excerpt:

> const providedRunId = typeof trigger.payload._runId === "string"

Evidence 3:

path: src/core/workflow/workflow-queue.ts

line: 140

excerpt:

> runId: existing?.runId ?? providedRunId ?? formatRunId(definition.name),

Evidence 4:

path: src/core/workflow/run-store.ts

line: 351

excerpt:

> if (runId !== undefined && runId.trim().length === 0)

Evidence 5:

path: src/core/workflow/run-store.ts

line: 354

excerpt:

> const id = runId ?? (typeof trigger.payload._runId === "string"

Evidence 6:

path: src/core/workflow/run-store.ts

line: 359

excerpt:

> const runDirPath = join(this.runsDir, id);

Evidence 7:

path: src/core/workflow/run-store.ts

line: 397

excerpt:

> writeJsonFile(join(runDirPath, "workflow.json"), buildWorkflowSnapshot(workflow));

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Completed fix centralizes workflow run-id validation in `src/core/workflow/run-io.ts`, strips arbitrary event-payload `_runId` values before workflow queueing, and validates explicit and trigger-payload run ids before run directory creation.
- Verification: `pnpm exec vitest run src/core/workflow/workflow-run-id-security.test.ts src/core/workflow/run-executor-utils.test.ts src/core/workflow/run-store-recover.test.ts` passed with 3 files / 23 tests.
- Verification: `pnpm typecheck` passed.
