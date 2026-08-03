---
id: task-codify-module-limit-transition-ordering
title: Codify module-limit transition ordering
status: ready
priority: p1
area: security
task_class: Safety
summary: Add a pure comparator for previous-to-next changes across every canonical module-limit variant using the shared transition result.
depends_on: [task-define-transition-results-and-write-limit-ordering]
created_at: 2026-08-03T17:48:37.327Z
updated_at: 2026-08-03T17:48:37.327Z
---

## Problem

    Module loading authority has its own allow, denial, and default behavior. Folding it into an aggregate classifier without a focused primitive risks treating a newly available module as harmless.

## Desired Outcome

    Core classifies module-limit changes as equal, permissive, or restrictive according to the existing module authorization semantics.

## Constraints

- Reuse the shared transition result and canonical module-limit types established by the foundational subtask.
- Base ordering on effective module authorization, including default-deny behavior, rather than raw collection shape or serialization.
- Keep previous-to-next direction explicit and the comparison pure and deterministic.
- Classify a mixed replacement conservatively when next authorizes any module that previous did not.
- Keep focused tests beside the owning core implementation.

## Done When

- Every currently defined canonical module-limit variant participates in the comparison.
- Tests cover authorization-equivalent values, added authority, removed authority, default-deny boundaries, and simultaneous additions and removals.
- The comparator returns only the shared equal, permissive, or restrictive result.
- The exact focused verification command and its passing result are recorded in the task.

## Source / Intent

    Module-authority seam of task-codify-per-dimension-scope-policy-transition-order, preserving the original Safety requirement that every security-relevant policy dimension have explicit ordering.

Decomposed from `task-codify-per-dimension-scope-policy-transition-order` after builder run `2026-08-03T16-47-03-525Z-builder-o42csw` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused unit-test output for equal, permissive, restrictive, default-deny, and mixed module-limit transitions.
- A recorded passing focused verification command.
- Code inspection showing the comparator delegates to canonical module authorization semantics without a second policy model.
