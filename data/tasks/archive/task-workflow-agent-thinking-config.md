---
status: done
---

# Add extended thinking configuration to workflow agent steps

## Problem

`WorkflowAgentStepInput` in `src/core/workflow/types.ts` exposes `model`, `maxTurns`,
`maxBudgetUsd`, and permission fields, but not `thinkingEnabled` or `thinkingBudget`.
The underlying `AgentSessionOptions` (`src/loop.ts`) supports both, and the CLI
respects them via `--thinking` and `--thinking-budget` flags. Workflow-level agent
steps have no way to enable this mode, even for steps where deeper reasoning would
improve output quality (e.g., the builder's `build` step on complex tasks).

## Desired Outcome

- `WorkflowAgentStepInput` gains optional `thinkingEnabled?: boolean` and
  `thinkingBudget?: number` fields.
- The workflow agent step executor (`src/core/workflow/step-executor-agent.ts`) passes
  these through to the underlying agent session.
- Operator-defined workflow definitions can opt specific agent steps into extended
  thinking by setting `thinkingEnabled: true` on the step.
- Built-in workflows (builder, explorer, improver) may optionally adopt these fields
  if extended thinking would improve their output quality.

## Constraints

- Default behavior is unchanged: `thinkingEnabled` defaults to `false`, matching
  current behavior and keeping costs stable for operators who don't opt in.
- `thinkingBudget` should have the same minimum (1024 tokens) enforced as the CLI.
- No changes to the core `AgentSession` API are needed — the fields already exist.
- Document the new step fields in `docs/WORKFLOWS.md` alongside the existing
  `model`, `maxTurns`, and `maxBudgetUsd` fields.

## Done When

- `WorkflowAgentStepInput` includes `thinkingEnabled` and `thinkingBudget`.
- The step executor passes them to the agent session when present.
- `docs/WORKFLOWS.md` documents the new fields.
- Existing workflow tests pass without modification.
