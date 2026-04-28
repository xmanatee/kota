# Decomposer Workflow

This directory contains the decomposer workflow definition and its prompt.

- Triggers on builder failure events and assesses whether the failure is timeout-shaped.
- When a timeout-shaped failure has a clear builder-owned task, an agent decomposes it into
  2-4 smaller subtasks and moves the original to `dropped/`.
- Keep decomposition logic inside this module, not in core or in the builder itself.

## First Consumer Of `askOwnerSteps`

Decomposer is the first autonomy workflow that splices the
`askOwnerSteps` recipe (`src/core/workflow/ask-owner-step.ts`) into its
definition. The escalation point is genuinely operator-only ambiguity:
the recovery payload's worktree summary names a candidate task id, the
failure was timeout-shaped, but the task is no longer in any active
state (`doing/`, `blocked/`, `ready/`). The pre-recipe behavior was a
silent skip — exactly the cost the umbrella notification-delivery task
identified as load-bearing waste, since the operator was the only one
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
