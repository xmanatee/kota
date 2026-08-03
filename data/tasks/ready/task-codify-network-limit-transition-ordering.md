---
id: task-codify-network-limit-transition-ordering
title: Codify network-limit transition ordering
status: ready
priority: p1
area: security
task_class: Safety
summary: Add a pure comparator for every canonical network-limit transition using effective network authorization and the shared transition result.
depends_on: [task-define-transition-results-and-write-limit-ordering]
created_at: 2026-08-03T17:48:37.327Z
updated_at: 2026-08-03T17:48:37.327Z
---

## Problem

    Network scope changes can cross default-deny and matcher-specific boundaries that raw value comparison cannot characterize safely.

## Desired Outcome

    Core explicitly classifies previous-to-next network-limit changes as equal, permissive, or restrictive under the existing network authorization rules.

## Constraints

- Consume canonical network-limit types and existing authorization semantics directly.
- Do not introduce normalized policy projections, compatibility aliases, or a separate network authority representation.
- Keep the comparator pure, deterministic, and explicit about previous-to-next direction.
- Ensure any newly authorized network target makes a mixed grant-and-revoke transition permissive for security review purposes.
- Keep implementation and focused tests in the owning core subtree.

## Done When

- All currently defined canonical network-limit variants and their default-deny behavior are covered.
- Tests exercise equivalent authorization, widening, narrowing, default-deny transitions, matcher boundaries, and mixed replacements.
- Every case returns the shared equal, permissive, or restrictive result.
- The exact focused verification command and its passing result are recorded in the task.

## Source / Intent

    Network-authority seam of task-codify-per-dimension-scope-policy-transition-order, supporting exhaustive restriction semantics for observable scope-policy revisions.

Decomposed from `task-codify-per-dimension-scope-policy-transition-order` after builder run `2026-08-03T16-47-03-525Z-builder-o42csw` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused unit-test output covering equal, permissive, restrictive, default-deny, matcher-boundary, and mixed network transitions.
- A recorded passing focused verification command.
- Code inspection showing canonical network authorization semantics remain the source of truth.
