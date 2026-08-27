---
status: open
priority: p1
depends_on: [task-align-verification-ownership-and-cadences, task-centralize-approval-lifecycle-state, task-centralize-owner-decision-lifecycle-state]
---

# Extract autonomy decision owners

## Scope / Starting Points

Inventory decision logic under `src/modules/autonomy`: queue admission/selection, blocker promotion, review projection, issue lifecycle, disposition, escalation, retry, and task-generation decisions embedded in workflows and prompts.

## Required Changes

- Extract deterministic decisions into small typed functions or state owners with explicit inputs and outcomes.
- Keep workflow definitions responsible for semantic routing, declared resources, authorization, agent invocation, and publication—not duplicated decision algorithms.
- Treat prompt-language quality as eval behavior; keep deterministic schema and safety boundaries outside prompts.
- Delete copied decision branches, call-count/order assertions, literal prompt checks, global setup, and shadow projections.

## Must Not Complete While

Any named decision has multiple owners, any deterministic decision exists only in prompt prose, or any inventory row is unresolved.

## Done When

Each decision family has one owner and outcome observation; workflows consume those owners and retain only orchestration behavior.

## Acceptance Evidence

Provide the decision/owner/workflow/disposition matrix and before/after production, executable-test, and authored-support LOC.

## Initiative

Child of `task-simplify-workflow-and-autonomy-tests`.
