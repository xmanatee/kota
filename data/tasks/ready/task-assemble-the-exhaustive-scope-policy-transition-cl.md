---
id: task-assemble-the-exhaustive-scope-policy-transition-cl
title: Assemble the exhaustive scope-policy transition classifier
status: ready
priority: p1
area: security
task_class: Safety
summary: Compose the tested dimension comparisons into one typed classifier with restrictive dominance and a compile-time coverage ratchet.
depends_on: [task-codify-per-dimension-scope-policy-transition-order]
created_at: 2026-08-03T16:18:03.778Z
updated_at: 2026-08-03T16:18:03.778Z
---

## Problem

    Consumers need one authoritative policy-level transition result, but aggregation must neither omit a security dimension nor misclassify mixed permissive and restrictive mutations.

## Desired Outcome

    Core exposes a single pure typed classifier that returns equal for unchanged authority, permissive for purely authority-expanding transitions, and restrictive whenever any policy dimension reduces authority.

## Constraints

- Build on the per-dimension ordering established by the prerequisite task without duplicating its semantics.
- Treat any restrictive dimension as dominant even when other dimensions become permissive in the same mutation.
- Derive or assert coverage against the canonical scope-policy type so adding a security-relevant dimension requires a deliberate classifier and test update.
- Do not add an authority store, events, compatibility surface, or alternate policy representation.
- Keep the classifier protocol-oriented and independent of daemon or module runtime state.

## Done When

- A typed policy-level classifier distinguishes equal, purely permissive, and restrictive transitions.
- Representative mixed transitions containing both permissive and restrictive dimension changes return restrictive.
- Black-box classifier tests exercise restrictive, permissive, and equal changes for every security-relevant policy dimension.
- A compile-time or equivalently enforced coverage check fails when the canonical security-relevant policy shape gains an unhandled dimension.
- The exact focused verification command and its passing result are recorded in the task.

## Source / Intent

    Completes task-define-exhaustive-scope-policy-restriction-semanti after its per-dimension semantics are isolated, preserving the restriction-classification seam required by task-add-revisioned-observable-scope-policy-authority and security-review finding active-workflow-scope-policy-snapshot.

Decomposed from `task-define-exhaustive-scope-policy-restriction-semanti` after builder run `2026-08-03T14-59-50-722Z-builder-4zcjba` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused unit-test output covering policy-level equal, permissive, restrictive, and mixed transitions.
- Type-check or focused guard evidence demonstrating that an unhandled security-relevant policy dimension cannot pass verification silently.
- A recorded passing verification command for the exported transition classifier.
