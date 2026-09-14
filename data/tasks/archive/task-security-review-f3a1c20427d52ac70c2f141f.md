---
status: done
---
# Security review: Every enqueue request containing retryOf now receives the explicit-retry override, including requests generated automatically by autonomy reconciliation. Workflow completion and reconciliation-needed events consequently bypass unchanged-evidence retention without an explicit retry request. Repeated failures can repeatedly restart autonomous work and consume execution capacity and model resources. An isolated production-code probe reproduced two requeues with identical task digests and recovery revisions while ordinary automatic recovery rejected the input.

security family: f3a1c20427d52ac70c2f141ff7a326531ed127bc69bc806e4e6aad8650942cc3

## Resolution

Fixed in `61a318b8a` before this finding's delayed publication. Retry controls
carry explicit intent separately from `payload.retryOf`; automatic reconciliation
does not set it. Transport preserves and validates that intent, and current task,
resource and publication checks remain in force. The selected queue/control tests
prove unchanged automatic retry is rejected and explicit retry preserves the same
run and resource. The focused control/transport suites pass (20 tests), as do
production typechecking, scoped lint and generated client-binding checks.

The daemon loaded that revision, and the normal retry API resumed retained builder
`2026-09-13T23-14-12-918Z-builder-9xqf3e` at 2026-09-14T02:54:10Z with its original
worktree, task resource and Codex conversation. Fresh validation followed. The
security reproduction below targets the earlier `c37f9b9cc`, not the corrected
revision; no duplicate implementation is required.


## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/workflow/runtime-runs-control.ts
claim:

> Every enqueue request containing retryOf now receives the explicit-retry override, including requests generated automatically by autonomy reconciliation. Workflow completion and reconciliation-needed events consequently bypass unchanged-evidence retention without an explicit retry request. Repeated failures can repeatedly restart autonomous work and consume execution capacity and model resources. An isolated production-code probe reproduced two requeues with identical task digests and recovery revisions while ordinary automatic recovery rejected the input.

## Desired Outcome

> Carry retry intent separately from payload.retryOf. Automatic reconciliation must retain ordinary evidence-gated recovery; only explicit authorized retry requests should bypass unchanged-revision rejection. This common repair covers both builder recovery and durable revision suppression.

> Separate automatic recovery from explicit retry authority and verify their composed production callers. Preserve explicit operator retries, current admission checks, and resource ownership. Regression coverage should show repeated reconciliation events retaining unchanged failures while an authorized explicit retry succeeds. Inspect retry-review-probe.json, retry-review-probe.mts, and retry-review-notes.md in the supplied run directory; agent execution and actual resource exhaustion were not exercised.

## Constraints

- Resolve every retained variant at the common owner; preserve distinct exploit preconditions and regression obligations.
- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## How We Will Know

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- The smallest proof that distinguishes the vulnerable and fixed behavior exercises the owning public boundary.
- The task records the final verification; add a regression test only when the defect could recur without another authoritative mechanism rejecting it.

## Context

Created by security-review workflow run 2026-09-14T02-41-34-393Z-security-review-6k37zr.

Confirmed by security-review workflow runs:

- 2026-09-14T02-41-34-393Z-security-review-6k37zr

security evidence: b091b94bb653c39a759e4a2a33ff03cf24daf296e999e64179389ac7857dfdb5
evidence identity: automatic-reconciliation-retryof-explicit-override-v1
production owner: src/core/workflow/runtime-runs-control
violated invariant: explicit-recovery-override-requires-explicit-intent
Common repair:
> Carry retry intent separately from payload.retryOf. Automatic reconciliation must retain ordinary evidence-gated recovery; only explicit authorized retry requests should bypass unchanged-revision rejection. This common repair covers both builder recovery and durable revision suppression.
Exploit preconditions:
> Autonomy reconciliation is enabled and a builder remains open, dependency-clear, and restartable in needs_attention. An attacker would need to influence task materials or agent output sufficiently to cause recurring retained failures or deferrals; that model-dependent influence was not tested. The automatic requeue mechanism was reproduced with an isolated retained run. Execution remains subject to existing scope, capacity, backoff, and publication controls.
finding id: automatic-reconciliation-escalates-to-explicit-retry
candidate id: tool-execution:src/core/workflow/runtime-runs-control.ts:1
verdict: confirmed
rationale:

> Automatic reconciliation submits retryOf, and runtime-runs-control.ts unconditionally passes explicitRetry=true. This bypasses both builder recovery's unchanged-input rejection and the database's consumed-revision guard. An independent rerun using fresh isolated SQLite state reproduced two successful reconciliation-triggered requeues with identical recovery revisions; ordinary recovery rejected both missing-baseline and unchanged-baseline controls. Production wiring emits reconciliation-needed when runs enter needs_attention. Scope, actionability, resource, admission, backoff, and publication checks remain enforced. Exploitation requires a restartable retained builder and recurring failures; attacker-induced model behavior and actual resource exhaustion were not demonstrated. Separating explicit retry intent from automatic retryOf requests addresses both bypasses through one repair. The archived admission-validation and forgeable-lineage findings concern distinct invariants, so the new family and null lineage are appropriate.

Evidence:

Evidence 1:



path: src/core/workflow/runtime-runs-control.ts

line: 67

excerpt:



> if (!await state.wfQueue.resumeRetainedRun(retryOf, Date.now(), true)) {

Evidence 2:



path: src/modules/autonomy/autonomy-issue-reconciliation-source.ts

line: 35

excerpt:



> await runtime.workflowRuntime.enqueuePendingRun(run.workflow, { payload: { retryOf: run.id } });

Evidence 3:



path: src/modules/autonomy/autonomy-issue-reconciliation-source.ts

line: 114

excerpt:



> ctx.events.subscribe("workflow.run.reconciliation-needed", (payload) => {

Evidence 4:



path: src/modules/autonomy/workflows/builder/recovery.ts

line: 67

excerpt:



> if (!input.explicitRetry && (baseline === revision || (baseline === undefined && admitted.taskDigest === current.taskDigest && !changedReview))) {

Evidence 5:



path: src/core/workflow/run-state-database.ts

line: 710

excerpt:



> if (prior.value?.revision === input.revision && !input.explicitRetry) return false;

Evidence 6:



path: src/core/workflow/run-coordinator.ts

line: 590

excerpt:



> if (outcome.state === "needs_attention") {
>       this.notifyReconciliationNeeded(run, "needs_attention", transitionedAt);
>     }
