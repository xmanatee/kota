# Decomposer Workflow

This directory contains the decomposer workflow definition and its prompt.

- Triggers on builder failure events and classifies structured timeout or
  exhausted repair outcomes.
- Reads the exact task id from the failed run's `task-claim.json`. When that
  task remains active, an agent resizes it into coherent subtasks and moves the
  original to `dropped/`.
- The `decomposition-applied` repair check rejects no-op agent completions and
  requires the dropped original and every ready subtask named by its
  `## Decomposed` section to belong to the current mutation set.
- Keep decomposition logic inside this module, not in core or in the builder itself.

## First Consumer Of `askOwnerSteps`

Decomposer is the first autonomy workflow that splices the
`askOwnerSteps` recipe (`src/core/workflow/ask-owner-step.ts`) into its
definition. The escalation point is genuinely operator-only ambiguity:
the failed builder's claim artifact names a candidate task id, but the task is
no longer in any active state (`doing/`, `blocked/`, `ready/`). The pre-recipe
behavior was a silent skip — exactly the cost the umbrella
notification-delivery task identified as load-bearing waste, since the
operator was the only one
who could distinguish "I already resolved this; drop the trigger" from
"the task was moved out of active states by accident; decompose it
anyway".

The recipe runs at the workflow layer (not as a tool call), so a daemon
restart mid-wait resumes the run via `installAwaitResumers`. The
wait must stay bounded so an unreachable operator cannot indefinitely block
the queue.

An approval lets the agent decompose the inactive task; any non-approval skips
the trigger. Suspicious operator text carries the injection-defense banner into
the agent step.
