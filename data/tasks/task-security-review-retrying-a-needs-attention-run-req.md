---
status: open
priority: p2
---
# Security review: Retrying a needs-attention run requeues its stored trigger without rechecking whether the current workflow still accepts the event, validates the payload, or admits the trigger. A stale run can therefore execute against a changed workflow contract that would reject a new or restored queued run.


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/workflow/workflow-queue.ts
claim:

> Retrying a needs-attention run requeues its stored trigger without rechecking whether the current workflow still accepts the event, validates the payload, or admits the trigger. A stale run can therefore execute against a changed workflow contract that would reject a new or restored queued run.

## Desired Outcome

> Apply the same current-definition revalidation used by restorePending before resuming a retained run: resolve the stored event against current triggers, validate its payload schema, run triggerAdmission, and verify repository/resources. Keep the run in needs_attention and return a conflict when any check fails.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-01T21-40-58-459Z-security-review-ionkfm.

Confirmed by security-review workflow runs:

- 2026-09-01T21-40-58-459Z-security-review-ionkfm

finding id: security-retained-run-resume-admission-bypass
candidate id: task-workflow-mutation:src/core/workflow/workflow-queue.ts:59
verdict: confirmed
rationale:

> resumeRetainedRun checks only enabled status, repository, and resources before changing a needs_attention run to queued. It does not resolve the stored trigger against the current trigger set, validate the current input schema, or invoke triggerAdmission. restorePending performs those checks only for already-queued runs, while execution subsequently combines the stored trigger with the currently loaded workflow definition.

Evidence:

Evidence 1:



path: src/core/workflow/runtime-runs-control.ts

line: 59

excerpt:



> const retryOf = options.payload?.retryOf;
> if (typeof retryOf === "string") {
>   const source = state.runtimeConfig.runState.getRun(retryOf);
>   if (source?.state === "needs_attention") {
>     ...
>     if (!state.wfQueue.resumeRetainedRun(retryOf, Date.now())) {

Evidence 2:



path: src/core/workflow/workflow-queue.ts

line: 383

excerpt:



> resumeRetainedRun(runId: string, resumedAtMs: number): boolean {
>   const run = this.config.runState.getRun(runId);
>   if (run?.state !== "needs_attention") return false;
>   const definition = this.definition(run.workflow);
>   if (!definition?.enabled) return false;
>   ...
>   if (run.repository !== definition.repository || !sameResources(run.resources, resources)) return false;
>   ...
>   this.config.runState.resumeRun(run.id, new Date(resumedAt).toISOString());

Evidence 3:



path: src/core/workflow/workflow-queue.ts

line: 135

excerpt:



> const resolution = resolveRestoredTrigger(definition, run.trigger);
> ...
> rejectInvalidTriggerPayload({ definition, trigger: run.trigger, ... })
> ...
> rejectUnadmittedWorkflowTrigger({ definition, ... trigger: run.trigger, ... })
