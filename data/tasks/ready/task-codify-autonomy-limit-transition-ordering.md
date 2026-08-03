---
id: task-codify-autonomy-limit-transition-ordering
title: Codify autonomy-limit transition ordering
status: ready
priority: p1
area: security
task_class: Safety
summary: Add an exhaustive pure comparator for canonical autonomy limits using the shared transition result and existing supervision semantics.
depends_on: [task-define-transition-results-and-write-limit-ordering]
created_at: 2026-08-03T17:48:37.327Z
updated_at: 2026-08-03T17:48:37.327Z
---

## Problem

    Autonomy posture determines how independently a session may act, but its previous-to-next security ordering is not yet captured by a focused, exhaustively tested primitive.

## Desired Outcome

    Core explicitly orders every canonical autonomy-limit transition as equal, permissive, or restrictive according to the existing autonomy and supervision semantics.

## Constraints

- Consume the canonical autonomy-limit type directly and preserve its existing meaning; do not create aliases or a parallel hierarchy.
- Reuse the shared transition result from the foundational subtask.
- Keep the comparator pure, deterministic, and explicit about previous and next values.
- Preserve default-deny or most-supervised behavior wherever the canonical policy omits an autonomy limit.
- Keep focused tests beside the owning core implementation.

## Done When

- An exhaustive pairwise transition matrix covers every canonical autonomy-limit value.
- Tests prove equal values remain equal, moves toward greater independence are permissive, moves toward greater supervision are restrictive, and omitted or default values preserve default-deny behavior.
- The comparator returns only the shared equal, permissive, or restrictive result.
- The exact focused verification command and its passing result are recorded in the task.

## Source / Intent

    Autonomy-authority seam completing task-codify-per-dimension-scope-policy-transition-order and supplying the last per-dimension primitive needed by the later exhaustive aggregate restriction semantics.

Decomposed from `task-codify-per-dimension-scope-policy-transition-order` after builder run `2026-08-03T16-47-03-525Z-builder-o42csw` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused unit-test output containing the exhaustive autonomy-limit transition matrix and default-boundary cases.
- A recorded passing focused verification command.
- Code inspection showing the comparator consumes the canonical autonomy type and existing supervision ordering.
