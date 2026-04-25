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

The escalation is gated on `assessFailure.output(ctx).escalation !== null`.
The recipe's three steps share the same gate predicate, so they all run
together or all skip together. The downstream `apply-escalation-outcome`
step consumes every `AwaitedOwnerOutcome` kind explicitly:

- `answered` matching the proposed `decompose <candidate>` collapses to
  `{ kind: "approved", ... }` — the agent step then runs against the
  task in its inactive state. Suspicious answers carry the recipe's
  pre-rendered `banner` so the downstream agent applies the
  injection-defense framing; `banner` stays `null` for clean answers.
- `answered` with anything else collapses to `{ kind: "skipped", ... }`.
- `dismissed`, `expired`, and `timeout` all collapse to
  `{ kind: "skipped", ... }` with a human-readable reason. The trigger
  is dropped — the failure signal is preserved in the source builder
  run's metadata, which decomposer can revisit if the task is moved
  back into an active state.

The recipe runs at the workflow layer (not as a tool call), so a daemon
restart mid-wait resumes the run via `installAwaitResumers`. The
`awaitTimeoutMs` is 15 minutes — short enough that an unreachable
operator cannot indefinitely block the queue, long enough that a human
checking notifications has a fair window.
