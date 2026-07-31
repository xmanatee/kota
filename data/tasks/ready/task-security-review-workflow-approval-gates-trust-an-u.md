---
id: task-security-review-workflow-approval-gates-trust-an-u
title: Security review: Workflow approval gates trust an unauthenticated status read from the project-local approval file. A same-user project writer can change a pending record to approved, after which the waiting workflow treats it as a human approval and continues to later side effects without passing through the review-digest or execution-descriptor checks.
status: ready
priority: p1
area: security
task_class: Safety
summary: Workflow approval gates trust an unauthenticated status read from the project-local approval file. A same-user project writer can change a pending record to approved, after which the waiting workflow treats it as a human approval and continues to later side effects without passing through the review-digest or execution-descriptor checks.
created_at: 2026-07-31T03:07:45.464Z
updated_at: 2026-07-31T03:07:45.464Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/core/workflow/steps/step-executor-approval.ts
claim:

> Workflow approval gates trust an unauthenticated status read from the project-local approval file. A same-user project writer can change a pending record to approved, after which the waiting workflow treats it as a human approval and continues to later side effects without passing through the review-digest or execution-descriptor checks.

## Desired Outcome

> Make endpoint-mediated queue resolution, rather than persisted JSON status, authoritative for a live workflow gate. Persist only authenticated resolution records using a daemon-held integrity key, verify them before consumption, and fail closed when integrity cannot be established after restart. Add a regression in which a same-user writer edits or replaces a pending gate record and prove the workflow does not resume.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-31T00-35-34-068Z-security-review-2pibca.

finding id: finding-workflow-approval-status-forgeable-from-project-storage
candidate id: auth-approval-boundary:src/core/daemon/approval-execution-selection.ts:1
verdict: confirmed
rationale:

> Workflow resumption trusts the status reparsed from project-local JSON. The filesystem protections prevent link and identity substitution during daemon writes but do not authenticate same-user in-place content changes. A runtime probe changed a pending gate to approved and ApprovalQueue.get accepted both the forged status and resolution source.

Evidence:

Evidence 1:



path: src/core/daemon/project-runtime.ts

line: 128

excerpt:



> const approvalQueue = new ApprovalQueue(join(projectDir, ".kota", "approvals"), pbus);

Evidence 2:



path: src/core/daemon/approval-queue.ts

line: 170

excerpt:



> get(id: string): PendingApproval | null {
>  return this.records.read(id)?.item ?? null;
> }

Evidence 3:



path: src/core/daemon/approval-record-repository.ts

line: 61

excerpt:



> private parse(snapshot: ApprovalRecordSnapshot): PendingApproval {
>  const path = join(this.storage.directoryPath, snapshot.filename);
>  const item = JSON.parse(snapshot.contents) as PendingApproval;

Evidence 4:



path: src/core/workflow/steps/step-executor-approval.ts

line: 51

excerpt:



> const current = queue.get(approval.id);
> if (!current) {
>   throw new Error(`${label}: approval record ${approval.id} disappeared from queue`);
> }
>
> if (current.status === "approved") {
>   resolved = true;

Evidence 5:



path: src/core/workflow/steps/step-executor-approval.ts

line: 69

excerpt:



> return {
>   approvalId: current.id,
>   approved: true,
>   resolvedAt: current.resolvedAt,
>   resolutionSource: current.resolutionSource ?? "human",

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
