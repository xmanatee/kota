---
status: done
---

# Finish builder task recovery for interrupted and repeated failures

## Problem

The recovery path in `src/modules/autonomy/workflows/improver/recover-doing-tasks.ts` only runs when the triggering builder status is `failed`. If the builder is `interrupted`, claimed work can still remain stranded in `tasks/doing/`.

The current recovery also always moves stranded work back to `ready/`. It never escalates obviously unhealthy work to `blocked/`, even after repeated failed attempts.

## Desired Outcome

- Builder recovery handles both `failed` and `interrupted` terminal statuses.
- Repeatedly failing or repeatedly recovered tasks can be escalated to `blocked/` with a concise blocker note instead of being bounced forever through `ready/`.
- Recovery remains conservative and easy to reason about.

## Constraints

- Keep recovery deterministic and code-driven, not prompt-driven.
- Do not add a second parallel recovery mechanism if one clear path can handle both cases.
- Preserve the current task-file workflow and move semantics.

## Done When

- A task stuck in `doing/` after a builder `failed` or `interrupted` run is recovered automatically.
- Repeatedly recovered tasks can be moved to `blocked/` instead of looping forever through `ready/`.
- Tests cover both failed and interrupted recovery paths.
