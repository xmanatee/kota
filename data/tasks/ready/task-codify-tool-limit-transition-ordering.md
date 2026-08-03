---
id: task-codify-tool-limit-transition-ordering
title: Codify tool-limit transition ordering
status: ready
priority: p1
area: security
task_class: Safety
summary: Add a pure comparator for canonical tool-limit changes, including availability and risk-related boundaries represented by the existing policy.
depends_on: [task-define-transition-results-and-write-limit-ordering]
created_at: 2026-08-03T17:48:37.327Z
updated_at: 2026-08-03T17:48:37.327Z
---

## Problem

    Tool authority can vary by availability and policy limits, so structural equality does not reveal whether a revision exposes a new executable capability.

## Desired Outcome

    Core classifies every canonical tool-limit transition through the shared equal, permissive, or restrictive result using existing effective tool-policy semantics.

## Constraints

- Use canonical tool-policy types and the existing effective tool-availability or authorization semantics.
- Do not duplicate tool resolution logic or introduce a flattened authority projection.
- Keep previous-to-next direction explicit and all comparison logic pure and deterministic.
- Treat any newly usable tool capability as permissive even when the same transition removes another capability.
- Keep focused tests beside the owning core implementation and satisfy strict-type policy.

## Done When

- Every currently defined tool-limit variant and default-deny boundary participates in the comparison.
- Tests cover equal effective authority, newly available capability, removed capability, relevant risk-limit boundaries, and mixed substitutions.
- The comparator returns only the shared equal, permissive, or restrictive result.
- The exact focused verification command and its passing result are recorded in the task.

## Source / Intent

    Tool-authority seam of task-codify-per-dimension-scope-policy-transition-order, enabling later aggregate restriction checks to detect newly executable capabilities.

Decomposed from `task-codify-per-dimension-scope-policy-transition-order` after builder run `2026-08-03T16-47-03-525Z-builder-o42csw` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused unit-test output for equal, permissive, restrictive, default-deny, risk-boundary, and mixed tool-limit transitions.
- A recorded passing focused verification command.
- Code inspection showing tool authorization remains canonical and is not reimplemented as a second policy surface.
