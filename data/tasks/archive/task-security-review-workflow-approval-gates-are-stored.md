---
status: done
---

# Security review: Workflow approval gates are stored using synthetic workflow-approval/* tool names, but the generic approval endpoint marks them approved and attempts to execute that synthetic name as a tool. Execution is reported as failed while the persisted approval remains approved, so the waiting workflow continues to later side effects despite the operator client reporting failure.

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/modules/approval-queue/approval-execution.ts
claim:

> Workflow approval gates are stored using synthetic workflow-approval/* tool names, but the generic approval endpoint marks them approved and attempts to execute that synthetic name as a tool. Execution is reported as failed while the persisted approval remains approved, so the waiting workflow continues to later side effects despite the operator client reporting failure.

## Desired Outcome

> Represent executable tool-call approvals and non-executable workflow gates as distinct validated approval kinds. Approval mutation handlers must not dispatch workflow-gate identities through executeTool; they should return an explicit gate-approved result that operator clients render as success. Add an end-to-end regression approving a workflow gate through the daemon route and verify that no synthetic tool execution occurs, the client receives an unambiguous success response, and the workflow resumes exactly once.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-07-29T15-20-52-174Z-security-review-4crulb.

finding id: finding-workflow-approval-synthetic-tool-failure-continues
candidate id: auth-approval-boundary:src/modules/approval-queue/approval-execution.ts:1
verdict: confirmed
rationale:

> At HEAD 76872349c849ad7517627cd2b3dafeecc7595846, src/core/workflow/steps/step-executor-approval.ts:33 stores a non-executable workflow gate as a synthetic tool name. src/modules/approval-queue/route-approval-execution.ts:111 approves it before src/modules/approval-queue/approval-execution.ts:104 dispatches it through executeTool. The unknown-tool result is projected as failed, but src/core/daemon/approval-queue.ts:165 has already persisted status approved, and the workflow resumes solely from that status at src/core/workflow/steps/step-executor-approval.ts:60. The CLI reports the failed projection as an execution failure at src/modules/approval-queue/cli.ts:225. An isolated probe reproduced executionStatus=failed, persistedStatus=approved, and workflowStepApproved=true.

Evidence:

Evidence 1:

path: src/core/workflow/steps/step-executor-approval.ts

line: 34

excerpt:

> `workflow-approval/${context.workflow.name}/${step.id}`,

Evidence 2:

path: src/modules/approval-queue/route-approval-execution.ts

line: 111

excerpt:

> const result = queue.approveForExecution(lease, note);

Evidence 3:

path: src/modules/approval-queue/approval-execution.ts

line: 90

excerpt:

> const result = executionContext ? await executeTool(item.tool, item.input, executionContext) : await executeTool(item.tool, item.input);

Evidence 4:

path: src/modules/approval-queue/approval-execution.ts

line: 56

excerpt:

> status: result.is_error ? "failed" : "succeeded",

Evidence 5:

path: src/core/workflow/steps/step-executor-approval.ts

line: 60

excerpt:

> if (current.status === "approved") {

Evidence 6:

path: src/modules/approval-queue/cli.ts

line: 225

excerpt:

> if (mutate.execution.status === "failed") { exitDaemonExecutionFailure(id, item.tool, mutate.execution); }

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.

## Verification

- `TMPDIR=/private/tmp NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run --configLoader runner --silent=true src/modules/approval-queue src/core/daemon/approval-queue.test.ts` — 37 files and 166 tests passed, including redacted gate storage, adversarial gate reclassification, mixed bulk resolution, and a real `WorkflowRuntime` continuation that applies its downstream side effect exactly once.
- Focused core, workflow, Slack, Telegram, secrets, module-dependency, and strict-type suites — 17 files and 86 tests passed.
- `NODE_OPTIONS=--conditions=source node_modules/.bin/tsc --noEmit` — passed.
- `NODE_OPTIONS=--conditions=source node --import tsx src/validate-queue.ts` — passed with the workspace-local Git index required by this linked worktree.
