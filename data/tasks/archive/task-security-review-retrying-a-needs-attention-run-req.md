---
status: done
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

## Result

The retained-run resume path now delegates to the same current-definition
revalidation used for durable queued-run restoration. Retry is rejected before
the run is requeued when its stored event is no longer declared, its payload no
longer validates (including stored `manual`, `resume`, and
`workflow.triggered` control triggers), current trigger admission rejects it,
or repository/resource ownership changed. That rejection now carries the typed
`workflow_contract_conflict` reason, which the daemon control route exposes as
HTTP 409. The workflow client decodes that reason separately from an
already-queued conflict, and both CLI and shared-UI retries report the contract
drift accurately. The preserved run remains in `needs_attention`.

The core revalidation hardening landed in commit `788d486e0` before this task
was dispatched. This task completed its control-trigger payload coverage,
public-boundary mapping, and operator-facing propagation.

## Verification

- `node --experimental-strip-types --check` over all fifteen changed TypeScript
  production and test files — passed, proving the repaired surfaces parse.
- `git diff --check` — passed, proving the proposed patch has no whitespace
  errors.
- The task queue validator was invoked directly but could not load the
  repository's `.js` source specifiers without the unavailable `tsx` package.
  Static inspection confirms the target id now exists only as a regular file in
  `data/tasks/archive/`, with the sole `status: done` frontmatter field and its
  H1 title preserved.
- Static inspection confirms every restorable trigger class now passes through
  current `inputSchema` validation before trigger admission and ownership
  checks; the runtime conflict reason then propagates through
  `WorkflowRuntime`, `DaemonControlHandle`, the daemon HTTP route, the typed
  workflow client, CLI output, and shared-UI action output.
- Repair attempt 3 aligned the original durable-restoration oracle with that
  shared validation: a stored `manual` trigger missing the required `revision`
  is now asserted cancelled, only the valid run is restored, and the recovered
  run count is one. This removes the critic-reported contradictory expectation.
- The focused owner-test command for
  `workflow-queue-restoration.test.ts`, `daemon-control.test.ts`,
  `daemon-client.test.ts`, and `ui-surface.test.ts` could not start in this
  repair sandbox: the worktree contains no package executables and access to
  the parent dependency installation is denied (`Operation not permitted`).
  The added cases cover declared-event drift, all three control-trigger payload
  variants, admission and ownership drift, the HTTP 409 response, typed client
  decoding, and shared-UI messaging once run in the normal dependency
  environment.
