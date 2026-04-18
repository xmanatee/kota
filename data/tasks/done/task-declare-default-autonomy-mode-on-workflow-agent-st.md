---
id: task-declare-default-autonomy-mode-on-workflow-agent-st
title: Declare default autonomy mode on workflow agent steps
status: done
priority: p2
area: workflow
summary: Replace the silent autonomous default on WorkflowAgentStep with an explicit per-step or per-workflow declaration and make the validator reject agent steps that lack an autonomy mode, so workflows state supervision intent instead of inheriting the most permissive option
created_at: 2026-04-18T04:01:42.463Z
updated_at: 2026-04-18T04:50:25.592Z
---

## Problem

`WorkflowAgentStep.autonomyMode` is currently optional in
`src/core/workflow/types.ts` and the validator silently coerces missing
values to `"autonomous"`
(`src/core/workflow/step-validators/validate-agent-step.ts:211`). Every
autonomous workflow — explorer, builder, improver, inbox-sorter,
decomposer, attention-digest, pr-reviewer, dispatcher — therefore runs
each of its agent steps under the most permissive mode regardless of
the agent's actual role. "Silent default to the most permissive
setting" violates the repo's strict-by-default rule and makes the new
core axis load-bearing only for interactive sessions. Supervision
intent for workflow runs should be declared in code, not inherited.

## Desired Outcome

- `WorkflowAgentStepInput` and `WorkflowAgentStep` treat `autonomyMode`
  as a required field. The validator rejects agent steps that omit it
  with a clear error pointing at the step id.
- Every workflow agent step in the repo sets its own mode based on
  role; the choice is explicit in each workflow file rather than
  silent.
- A workflow definition may declare a `defaultAutonomyMode` at the
  workflow level, used only as a scoped default for its own steps.
  Individual steps may still set a stricter mode. There is no
  repo-wide default.
- Recovery reset steps inside recovery-capable workflows do not
  inherit a looser mode than the workflow's main agent step.

## Constraints

- Strict typed protocol. No silent coercion anywhere in the step
  pipeline. Remove the `?? "autonomous"` fallback in
  `validate-agent-step.ts`.
- Keep the mode choice per step, not per workflow-run. Trigger payloads
  should not mutate `autonomyMode` at runtime.
- Do not weaken any existing workflow's effective behavior without a
  stated reason in the workflow's `AGENTS.md` or commit message. The
  migration is "declare the mode that matches today's behavior" unless
  the role argues for a stricter one.
- Do not introduce a new autonomy module. The field lives on the
  existing core step protocol; workflow authors set it in `workflow.ts`.
- Preserve the current autonomy-mode test at the tool-runner boundary;
  this task is about the declaration and validation edge, not the
  runtime semantics.

## Done When

- `WorkflowAgentStep.autonomyMode` is required in
  `src/core/workflow/types.ts` (input and normalized shapes) and the
  validator rejects agent steps without a mode, with a test.
- Every autonomy workflow in `src/modules/autonomy/workflows/` declares
  an explicit `autonomyMode` on each of its agent steps or sets a
  workflow-level default that the validator applies.
- An optional workflow-level `defaultAutonomyMode` exists and is
  applied to any step that does not set its own mode; the validator
  rejects a workflow that leaves steps undefaulted.
- Docs in `src/modules/autonomy/workflows/AGENTS.md` describe the new
  declaration rule once, at the conventions level.
- `validation.test.ts` asserts the new required-field behavior instead
  of the current "defaults to autonomous" assertion.
