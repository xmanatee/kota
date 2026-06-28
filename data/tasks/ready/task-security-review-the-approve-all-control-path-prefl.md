---
id: task-security-review-the-approve-all-control-path-prefl
title: Security review: The approve-all control path preflights one pending approval snapshot, then approves and executes a freshly recomputed pending set. A new approval queued during the asynchronous MCP preflight window can be included in approve-all execution without being part of the preflighted/operator-reviewed snapshot.
status: ready
priority: p2
area: security
summary: The approve-all control path preflights one pending approval snapshot, then approves and executes a freshly recomputed pending set. A new approval queued during the asynchronous MCP preflight window can be included in approve-all execution without being part of the preflighted/operator-reviewed snapshot.
created_at: 2026-06-28T12:25:38.764Z
updated_at: 2026-06-28T12:25:38.764Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/approval-queue/route-helpers.ts
claim:

> The approve-all control path preflights one pending approval snapshot, then approves and executes a freshly recomputed pending set. A new approval queued during the asynchronous MCP preflight window can be included in approve-all execution without being part of the preflighted/operator-reviewed snapshot.

## Desired Outcome

> Change approve-all execution to capture a single pending approval id list before any await, preflight exactly that list, and approve/execute only those ids. Newly queued approvals should remain pending for a separate operator decision, and tests should cover an approval enqueued during MCP preflight.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-28T12-17-50-568Z-security-review-wet7it.

finding id: security-review-approve-all-snapshot-race
candidate id: auth-approval-boundary:src/modules/approval-queue/approval-execution.ts:66
verdict: confirmed
rationale:

> writeApproveAllApprovalsMutation preflights queue.list("pending") at src/modules/approval-queue/route-helpers.ts:228, awaits the batch, then calls approveAllApprovalsLocal at src/modules/approval-queue/route-helpers.ts:236. approveAllApprovalsLocal delegates to ApprovalQueue.approveAllForExecution, which takes a fresh pending snapshot at src/core/daemon/approval-queue.ts:240 and approves every item in that new list at src/core/daemon/approval-queue.ts:246. The response then executes every approved item from that post-await list at src/modules/approval-queue/approval-execution.ts:257, using leases only opportunistically. For non-MCP tools, executeApprovedTool runs executeTool without requiring a lease, so a newly queued non-MCP approval during MCP preflight can be approved and executed without being in the preflighted/operator-reviewed snapshot.

Evidence:

Evidence 1:



path: src/modules/approval-queue/route-helpers.ts

line: 228

excerpt:



> const preflight = await prepareApprovalExecutionBatch(
>    queue.list("pending"),
>    executionContext,
>   );

Evidence 2:



path: src/modules/approval-queue/route-helpers.ts

line: 236

excerpt:



> const result = approveAllApprovalsLocal(queue, note);

Evidence 3:



path: src/modules/approval-queue/route-helpers.ts

line: 243

excerpt:



> jsonResponse(res, 200, await approveAllResponse(
>     result.approvals,
>     executionContext,
>     preflight.leases,
>    ));

Evidence 4:



path: src/core/daemon/approval-queue.ts

line: 239

excerpt:



> approveAllForExecution(note?: string): ApprovalExecutionApproveAllResult {
>    const pending = this.list("pending");

Evidence 5:



path: src/core/daemon/approval-queue.ts

line: 246

excerpt:



> for (const item of pending) {
>     const result = this.approveForExecution(item.id, note);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
