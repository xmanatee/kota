---
id: task-define-exhaustive-scope-policy-restriction-semanti
title: Define exhaustive scope-policy restriction semantics
status: dropped
priority: p1
area: security
task_class: Safety
summary: Add a pure, protocol-oriented comparison that classifies equal, permissive, and restrictive scope-policy transitions across every security-relevant dimension.
created_at: 2026-08-03T15:31:42.493Z
updated_at: 2026-08-03T16:18:03.806Z
---

## Problem

    A revisioned authority cannot safely notify consumers until KOTA has one explicit and exhaustive definition of what makes a scope-policy mutation restrictive. Ad hoc comparisons could omit write, module, network, tool, or autonomy restrictions.

## Desired Outcome

    Core exposes a single typed transition classifier that treats any restrictive dimension in a mixed mutation as restrictive and distinguishes equal and purely permissive transitions.

## Constraints

- Cover every existing security-relevant scope-policy dimension, including write, module, network, tool, and autonomy limits.
- Preserve existing restriction semantics and default-deny behavior.
- Keep the classifier pure and protocol-oriented in core.
- Do not introduce an authority store, compatibility wrapper, or second policy representation.
- Require deliberate test and classifier updates when a new security-relevant policy dimension is added.

## Done When

- A typed classifier distinguishes equal, purely permissive, and restrictive policy transitions.
- Mixed transitions are classified as restrictive whenever any dimension becomes more restrictive.
- Focused tests exercise restrictive, permissive, and equal changes for every security-relevant policy dimension.
- The focused verification command and passing result are recorded in the task.

## Source / Intent

    First seam of task-add-revisioned-observable-scope-policy-authority, created from confirmed finding active-workflow-scope-policy-snapshot in security-review run 2026-08-02T12-54-03-665Z and rescoped after builder run 2026-08-03T14-32-25-880Z-builder-1yp7jy exhausted repair.

Decomposed from `task-add-revisioned-observable-scope-policy-authority` after builder run `2026-08-03T14-32-25-880Z-builder-1yp7jy` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused unit tests covering every policy dimension and representative mixed transitions.
- A recorded passing verification command for the transition classifier.

## Decomposed

- task-codify-per-dimension-scope-policy-transition-order
- task-assemble-the-exhaustive-scope-policy-transition-cl
