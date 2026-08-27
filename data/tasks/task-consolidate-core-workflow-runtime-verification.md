---
status: open
priority: p1
depends_on: [task-align-verification-ownership-and-cadences, task-migrate-historical-run-metadata-safely]
---

# Consolidate core workflow runtime verification

## Scope / Starting Points

Inventory `src/core/workflow`, workflow daemon integration, run store, resources, publications, waiting/resume, recovery, blocking operations, testing helpers, fake runtimes, and every copied lifecycle matrix.

## Required Changes

- Assign admission, state transitions, resources, waiting, integration, recovery, effects, and publication to named core owners.
- Retain one strongest observation for each distinct runtime failure and one real composition path where isolation cannot prove correctness.
- Delete copied lifecycle matrices, private phase/step-order assertions, fake-runtime variants, broad reset hooks, and source-absence checks.
- Keep protocol, durability, concurrency, crash recovery, and commit/publication boundaries explicit.

## Must Not Complete While

Any lifecycle state or helper family is unclassified, any autonomy workflow repeats the core matrix, or a shadow runtime/mega-fixture remains.

## Done When

The inventory has zero unresolved rows and private runtime refactors do not affect consumers while durable outcomes remain unchanged.

## Acceptance Evidence

Provide the lifecycle/owner/scenario/disposition matrix and before/after production, executable-test, and authored-support LOC.

## Initiative

Child of `task-simplify-workflow-and-autonomy-tests`.
