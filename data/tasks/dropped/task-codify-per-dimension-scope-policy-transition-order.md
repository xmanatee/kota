---
id: task-codify-per-dimension-scope-policy-transition-order
title: Codify per-dimension scope-policy transition ordering
status: dropped
priority: p1
area: security
task_class: Safety
summary: Add pure typed comparison primitives that define equal, permissive, and restrictive transitions for every existing security-relevant scope-policy dimension.
created_at: 2026-08-03T16:18:03.778Z
updated_at: 2026-08-03T17:48:37.388Z
---

## Problem

    The aggregate classifier cannot be trustworthy while write, module, network, tool, and autonomy limits lack explicit, independently tested transition ordering. Combining these semantics directly inside one aggregate function obscures omissions and made the prior builder task too broad.

## Desired Outcome

    Core contains one protocol-oriented set of typed comparison primitives that applies the existing authorization and default-deny semantics to previous-to-next changes in every security-relevant scope-policy dimension.

## Constraints

- Use the canonical scope-policy types and existing authorization semantics; do not introduce a projection, compatibility wrapper, authority store, or second policy representation.
- Keep every comparison pure, deterministic, and owned by core.
- Make the previous-policy to next-policy direction explicit and preserve default-deny behavior.
- Cover write, module, network, tool, and autonomy limits with a shared typed transition result.
- Keep tests beside the owning core implementation and follow local strict-type and layout rules.

## Done When

- Typed per-dimension comparisons return equal, permissive, or restrictive for all existing security-relevant policy dimensions.
- Focused tests exercise equal, permissive, and restrictive changes for write, module, network, tool, and autonomy limits.
- Tests cover boundary cases implied by the existing default-deny and authorization semantics.
- The exact focused verification command and its passing result are recorded in the task.

## Source / Intent

    Semantic foundation for task-define-exhaustive-scope-policy-restriction-semanti, itself the first seam of task-add-revisioned-observable-scope-policy-authority from security-review finding active-workflow-scope-policy-snapshot; decomposed after builder run 2026-08-03T14-59-50-722Z-builder-4zcjba exhausted repair.

Decomposed from `task-define-exhaustive-scope-policy-restriction-semanti` after builder run `2026-08-03T14-59-50-722Z-builder-4zcjba` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused unit-test output showing equal, permissive, and restrictive cases for every named policy dimension.
- A recorded passing repository verification command for the per-dimension comparison primitives.
- Code inspection showing the primitives consume canonical policy types without adding a parallel representation.

## Decomposed

- task-define-transition-results-and-write-limit-ordering
- task-codify-module-limit-transition-ordering
- task-codify-network-limit-transition-ordering
- task-codify-tool-limit-transition-ordering
- task-codify-autonomy-limit-transition-ordering
