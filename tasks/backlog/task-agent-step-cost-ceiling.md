---
id: task-agent-step-cost-ceiling
title: Add per-step cost ceiling to agent steps to bound runaway sessions
status: backlog
priority: p3
area: runtime
summary: The daily budget guard catches overall overspend but cannot stop a single runaway agent step mid-flight. A per-step maxCostUsd ceiling would abort an agent step once it exceeds the limit, preventing a single session from consuming the entire budget before the guard fires.
created_at: 2026-04-01T08:14:00Z
updated_at: 2026-04-01T08:14:00Z
---

## Problem

`BudgetGuard` tracks daily spend per workflow and emits `workflow.budget.exceeded` when the
day's total crosses a threshold. But it fires after the fact — once a step completes. An
agent step that enters a runaway repair loop or receives an unexpectedly large context
can exhaust the daily budget in a single step before the guard has a chance to intervene.

There is no mechanism to say "abort this agent step if it spends more than $X", short of
terminating the daemon. Operators who want tight per-run or per-step cost control must
rely solely on daily caps.

## Desired Outcome

An optional `maxCostUsd` field on agent step definitions. When set, the step executor
monitors cumulative cost after each agent turn. If the running total exceeds `maxCostUsd`,
the step is aborted with a `StepCostCeilingExceeded` error, the run fails (or continues
if `continueOnFailure` is set on the step), and a `workflow.cost.ceiling.exceeded` bus
event is emitted so notification extensions can alert the operator.

Example:
```ts
{
  id: "build",
  type: "agent",
  maxCostUsd: 0.50,   // abort this step if it exceeds $0.50
  prompt: "...",
}
```

## Constraints

- `maxCostUsd` is optional; omitting it preserves today's behavior exactly.
- Cost is accumulated per-step across agent turns using the same cost tracking already
  present in `AgentSession` / loop state.
- The abort must be clean: the current agent turn finishes (no mid-turn cut), then the
  step exits with an error before the next turn starts.
- Add `workflow.cost.ceiling.exceeded` to `BusEvents` in `src/event-bus-types.ts`.
- Telegram and webhook extensions should already pick up the new event via their generic
  subscription pattern; verify and document if any wiring is needed.
- Document `maxCostUsd` in `docs/WORKFLOWS.md` step reference.

## Done When

- `maxCostUsd` is accepted on agent step definitions and enforced by the executor.
- Exceeding the ceiling aborts the step with a descriptive error.
- `workflow.cost.ceiling.exceeded` is emitted and documented in `BusEvents`.
- Unit test covers: step under ceiling (completes normally), step over ceiling (aborts after current turn).
- `docs/WORKFLOWS.md` documents the field.
