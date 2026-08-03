---
id: task-define-transition-results-and-write-limit-ordering
title: Define transition results and write-limit ordering
status: ready
priority: p1
area: security
task_class: Safety
summary: Introduce the shared typed equal, permissive, or restrictive transition result and a pure previous-to-next comparator for canonical write limits.
created_at: 2026-08-03T17:48:37.327Z
updated_at: 2026-08-03T17:48:37.327Z
---

## Problem

    Write authority has path-specific and default-deny boundaries that cannot safely remain implicit inside an aggregate scope-policy classifier. The remaining dimension comparators also need one canonical transition result without creating another policy representation.

## Desired Outcome

    Core owns a shared transition result and a write-limit comparator that classifies changes according to the existing write authorization semantics.

## Constraints

- Consume the canonical scope-policy and write-limit types directly; do not add a projection, compatibility wrapper, authority store, or second policy representation.
- Keep the comparator pure and deterministic, with previous and next values explicit in its API.
- Use the existing write authorization semantics for path containment and default denial rather than comparing serialized policy syntax.
- Treat any mixed transition that grants previously unavailable write authority conservatively so a simultaneous revocation cannot hide the new grant.
- Keep implementation and focused tests in the owning core subtree and comply with strict-type and root-layout rules.

## Done When

- A shared typed transition result exposes exactly equal, permissive, and restrictive outcomes.
- The write comparator returns equal for authorization-equivalent limits, permissive when next grants any previously unavailable write authority, and restrictive when next only removes authority.
- Tests cover empty or omitted default-deny limits, identical limits, nested or overlapping path boundaries, widening, narrowing, and mixed grant-and-revoke changes.
- The exact focused verification command and its passing result are recorded in the task.

## Source / Intent

    First implementation seam of task-codify-per-dimension-scope-policy-transition-order, which provides the semantic foundation for task-define-exhaustive-scope-policy-restriction-semanti and the revisioned observable scope-policy authority initiative.

Decomposed from `task-codify-per-dimension-scope-policy-transition-order` after builder run `2026-08-03T16-47-03-525Z-builder-o42csw` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused unit-test output demonstrating equal, permissive, restrictive, default-deny, containment, and mixed write-limit cases.
- A recorded passing focused verification command.
- Code inspection showing the result and comparator consume canonical core policy types without introducing a parallel representation.
