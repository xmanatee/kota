---
id: task-run-detail-approval-step-inline
title: Show approval step waiting state in web UI run detail panel
status: ready
priority: p3
area: operator-ux
summary: When a workflow run is blocked at an approval step, the run detail panel shows the step as generically "running" with no indication that human action is needed. Adding a "waiting for approval" indicator with a link to the approvals panel would let operators act without navigating away.
created_at: 2026-04-02T04:47:39Z
updated_at: 2026-04-02T05:05:00Z
---

## Problem

The web UI run detail panel renders step status icons (running, success, failed) but treats
`type: "approval"` steps identically to any other running step. When a workflow is blocked
waiting for operator approval, the run detail shows a plain "▶" icon for the approval step,
with no indication that human action is needed or where to take it.

Operators who open the run detail to diagnose a stalled run must separately navigate to the
Approvals panel to see the pending queue item. There is no inline context connecting the
blocked run to its approval request.

## Desired Outcome

When `step.type === "approval"` and `step.status === "running"`, the run detail step row
displays:

- A distinct visual indicator (e.g., "⏳ Waiting for approval" label or badge).
- The step's `reason` text if available in the step output or run payload.
- A direct link to the Approvals panel so the operator can approve or reject without
  extra navigation.

When the approval step resolves (approved or rejected), the step row should update to show
the final status normally (✓ or ✗).

## Constraints

- Change is limited to `client-run-detail.ts` and related styles; no new server routes or
  daemon API changes required.
- The approval link should open the Approvals panel tab, not navigate away from the run
  detail page — consistent with how the web UI handles panel switching.
- The reason text comes from the step record already available in the run detail response.
- Do not break existing rendering of foreach, branch, or other step types.

## Done When

- Approval steps in a running state display a "Waiting for approval" visual cue in the
  run detail panel.
- A link or button routes the operator to the Approvals panel.
- Resolved approval steps (approved/rejected) render with normal success/failure styling.
- Existing web UI tests pass; new tests cover the approval step rendering path.
