---
id: task-security-review-approval-execution-is-not-bound-to
title: Security review: Approval execution is not bound to the descriptor that was selected and preflighted. The route preflights one disk-backed approval snapshot, the queue re-reads the mutable record while approving it, and execution dispatches using the later tool name with the original in-memory input. A concurrent project writer can substitute another local or MCP tool after preflight and bypass the operator and MCP declaration boundary.
status: ready
priority: p1
area: security
task_class: Safety
summary: Approval execution is not bound to the descriptor that was selected and preflighted. The route preflights one disk-backed approval snapshot, the queue re-reads the mutable record while approving it, and execution dispatches using the later tool name with the original in-memory input. A concurrent project writer can substitute another local or MCP tool after preflight and bypass the operator and MCP declaration boundary.
created_at: 2026-07-28T10:54:24.529Z
updated_at: 2026-07-28T10:54:24.529Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: high
affected path: src/modules/approval-queue/approval-execution.ts
claim:

> Approval execution is not bound to the descriptor that was selected and preflighted. The route preflights one disk-backed approval snapshot, the queue re-reads the mutable record while approving it, and execution dispatches using the later tool name with the original in-memory input. A concurrent project writer can substitute another local or MCP tool after preflight and bypass the operator and MCP declaration boundary.

## Desired Outcome

> Atomically compare-and-transition the exact approval snapshot used for preflight. Bind the execution lease to the approval id, tool, scope, session, input digest, and MCP fingerprints, and reject any mismatch before dispatch. Add a regression that mutates the stored tool during delayed MCP preflight.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-28T10-43-27-309Z-security-review-03tlkp.

finding id: finding-approval-execution-descriptor-substitution
candidate id: auth-approval-boundary:src/modules/approval-queue/approval-execution.ts:77
verdict: confirmed
rationale:

> The route awaits preflight for one disk snapshot, then approveForExecution and approve reread the mutable record. The resulting descriptor is combined with the original in-memory input, while the lease binds only the approval id and optional MCP manager. Execution does not compare the tool, scope, session, input digest, or MCP metadata with the preflighted snapshot.

Evidence:

Evidence 1:



path: src/modules/approval-queue/route-helpers.ts

line: 224

excerpt:



> const preflight = await prepareApprovalExecutionBatch([pending], executionContext);

Evidence 2:



path: src/modules/approval-queue/route-helpers.ts

line: 231

excerpt:



> const result = queue.approveForExecution(id, note);

Evidence 3:



path: src/core/daemon/approval-queue.ts

line: 216

excerpt:



> const item = this.get(id);

Evidence 4:



path: src/modules/approval-queue/approval-execution.ts

line: 287

excerpt:



> if (isMcpManagedToolName(item.tool)) {

Evidence 5:



path: src/modules/approval-queue/approval-execution.ts

line: 298

excerpt:



> ? await executeTool(item.tool, item.input, executionContext)

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
