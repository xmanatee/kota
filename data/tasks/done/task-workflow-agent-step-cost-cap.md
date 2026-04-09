---
id: task-workflow-agent-step-cost-cap
title: Add per-step cost cap to workflow agent steps
status: done
priority: p2
area: runtime
summary: Workflow agent steps have no per-step spending limit. A runaway or looping agent step can exhaust the daily budget in a single run with no early abort.
created_at: 2026-04-09T03:50:00Z
updated_at: 2026-04-09T03:50:00Z
---

## Problem

Workflow agent steps have access to `dailyBudgetUsd` as a global cap, but there
is no way to set a per-step or per-run cost ceiling. A prompt regression, a
tool loop, or an unexpectedly long agent step can burn through the daily budget
in one run before any operator intervention is possible.

This is especially risky for the built-in autonomous workflows (explorer,
builder, improver) and for user-defined agent steps that call expensive models.

## Desired Outcome

An optional `maxCostUsd` field on workflow agent steps:

```ts
{
  type: "agent",
  name: "build",
  maxCostUsd: 0.50
}
```

When the step's accumulated spend reaches `maxCostUsd`, the agent loop is
aborted cleanly and the step fails with a `cost_cap_exceeded` error. The run
follows the existing failure path (failed status, `workflow.failure.alert`
emitted, operator notified).

The field is optional. Omitting it preserves current behavior.

## Constraints

- Uses `CostTracker` (already available per session) to check spend after each
  turn.
- The check happens after each model turn, not mid-turn.
- The step's final cost and the cap value appear in the failure message so
  operators know what triggered the abort.
- Works for all model providers (Anthropic, OpenAI, etc.) that report token usage.
- Document the field in `docs/WORKFLOWS.md` alongside the existing step options.

## Done When

- Agent steps accept `maxCostUsd` in the workflow schema and TypeScript type.
- A step that exceeds `maxCostUsd` is aborted after the turn that crosses the
  threshold and fails with a clear error message.
- The failure message includes actual spend, the cap, and the step name.
- A unit test verifies: normal run under cap completes, run that crosses cap
  fails with `cost_cap_exceeded`, and absence of field behaves as before.
- `docs/WORKFLOWS.md` documents the field.
