---
status: open
priority: p1
depends_on: [task-consolidate-core-workflow-runtime-verification, task-extract-autonomy-decision-owners]
---

# Migrate autonomy workflow verification families

## Scope / Starting Points

Inventory every workflow below `src/modules/autonomy/workflows`, grouped at minimum into build/review/decompose/improve, queue/promotion/intake, health/monitor/calibration, research/retry/explore, and digest/notification families.

## Required Changes

- Migrate each family to the core runtime and extracted decision owners.
- Retain workflow observations only for semantic routing, resources, authorization, agent output schema, published outcome, and distinct recovery/integration behavior.
- Remove private phase, helper-order, command-call, prompt-string, evidence-filename, source-absence, and copied lifecycle assertions.
- Delete obsolete fixture builders and global reset/setup infrastructure as final consumers disappear.

## Must Not Complete While

Any workflow family or fixture is unclassified, any core lifecycle matrix remains copied, or deterministic behavior is moved into eval fixtures.

## Done When

Every workflow family has zero unresolved inventory rows and each retained scenario names a workflow-specific failure beyond core runtime and decision owners.

## Acceptance Evidence

Provide the workflow-family/scenario/disposition matrix and before/after production, executable-test, and authored-support LOC.

## Initiative

Child of `task-simplify-workflow-and-autonomy-tests`.
