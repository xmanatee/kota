---
id: task-agent-step-cost-ceiling
title: Emit bus event and document maxBudgetUsd per-step cost ceiling
status: ready
priority: p3
area: runtime
summary: Agent steps already accept maxBudgetUsd to abort when spend exceeds a threshold, but no bus event is emitted when the ceiling fires, and the field is undocumented in WORKFLOWS.md. Adding the event and docs closes the observability gap.
created_at: 2026-04-01T08:14:00Z
updated_at: 2026-04-02T00:00:00Z
---

## Problem

`WorkflowAgentStep` already has `maxBudgetUsd` and the executor passes it through to the
agent SDK, which aborts the step when spend exceeds the limit. However:

1. No bus event is emitted when a step is aborted by the ceiling, so notification
   extensions and operators have no automated signal that a cost ceiling was hit.
2. `maxBudgetUsd` is not documented in `docs/WORKFLOWS.md`, so operators discovering the
   type definition have no guidance on expected behavior.

## Desired Outcome

- A `workflow.cost.ceiling.exceeded` event is added to `BusEvents` and emitted by
  `step-executor-agent.ts` when the agent SDK returns a budget-exceeded result.
- `docs/WORKFLOWS.md` documents `maxBudgetUsd` on agent steps with an example.
- Telegram and webhook extensions pick up the new event (verify generic subscription
  covers it, or add explicit wiring).

## Constraints

- Do not change how `maxBudgetUsd` is enforced — the SDK already handles the abort.
- The event should carry: workflow, runId, stepId, budgetUsd, actualCostUsd (if available).
- No new persistence or config changes required.

## Done When

- `workflow.cost.ceiling.exceeded` is defined in `BusEvents` and emitted on ceiling hit.
- `docs/WORKFLOWS.md` documents `maxBudgetUsd` on agent step definitions.
- At least one unit test verifies the event is emitted when the ceiling is exceeded.
