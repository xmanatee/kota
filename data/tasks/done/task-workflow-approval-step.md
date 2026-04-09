---
id: task-workflow-approval-step
title: Add approval step type to workflow definitions
status: done
priority: p2
area: runtime
summary: Workflow definitions have no first-class way to pause and wait for human approval between steps. An `approval` step type would block execution until the operator approves or rejects via the existing approval queue, enabling human-gated pipelines without custom agent logic.
created_at: 2026-04-02T03:58:38Z
updated_at: 2026-04-02T05:15:00Z
---

## Problem

Workflow agent steps interact with the approval queue only indirectly — when a
guardrail policy classifies a tool call as dangerous and suspends it for human
review. There is no way to declare an explicit pause point in a workflow
definition where operator sign-off is required before continuing, regardless of
what tools are invoked.

Teams running workflows with consequential side effects (deployments, bulk
mutations, financial transactions) must either rely on tool-level guardrails or
embed custom approval-polling logic inside code steps. Neither approach is
transparent in the workflow definition itself; a reader cannot tell at a glance
where human gates exist.

## Desired Outcome

A new `type: "approval"` step kind in `WorkflowDefinitionInput` that:

- Registers an approval request in the existing `ApprovalQueue` when execution
  reaches the step.
- Blocks the workflow run until the approval is resolved (approved or rejected).
- On approval: records the step as `success` and continues to the next step.
- On rejection: fails the run with a clear message; follows the normal failure
  path (`workflow.failure.alert` emitted if configured).
- Optional `timeoutMs` and `defaultResolution` fields mirror the existing
  `ApprovalQueue` item shape — if the approval expires, the default resolution
  applies.
- The approval item shown in the web UI and CLI includes the workflow name,
  run ID, step ID, and any optional `reason` field from the step definition.

## Constraints

- The new step type extends the existing `ApprovalQueue` — no new persistence
  layer.
- `approval` steps are not supported inside `foreach`, `parallel`, or `branch`
  bodies; validate and reject at definition-load time with a clear error.
- Approval requests from `approval` steps must be distinguishable from
  guardrail-generated approval requests (e.g., `source: "workflow-step"` vs.
  `source: "guardrail"`) so operators can triage them separately.
- Add `WorkflowApprovalStepInput` to `WorkflowStepInput` union in `types.ts`.
- Add a `step-validators/approval.ts` validator following existing per-step
  validator pattern.
- `WorkflowTestHarness` should support mocking approval steps (approve by
  default unless a mock says reject).
- Document the step type in `docs/WORKFLOWS.md`.

## Done When

- `type: "approval"` step is accepted by the workflow validator.
- A workflow with an approval step pauses execution and creates an approval
  queue entry visible in `kota approval list` and the web UI.
- Approving resumes the run; rejecting fails it with a clear message.
- `approval` steps in unsupported contexts (foreach/parallel/branch bodies) are
  rejected at validation time with a descriptive error.
- `WorkflowTestHarness` handles approval steps without spawning a daemon.
- `docs/WORKFLOWS.md` documents the new step type with an example.
- Existing tests pass unchanged.
