---
status: done
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

## Implementation evidence

The run's `decision-owners.md` records the decision/owner/workflow/disposition
matrix. `decision-loc-before.json` and `decision-loc-after.json` retain per-file
inventories; `repair-summary.md` records current proof and limitations.

Queue/blocker decisions, judge responses, scoped decision observations, and
shared task/question disposition now have typed owners consumed by workflows.
Delayed scope-improvement publication reconciles integrated tasks independently
of semantic freshness, while later task retirement and owner-question replay
remain protected. The latest 17 focused owner tests, production/test types and
scoped Biome checks pass. Earlier run evidence records the broader extraction
checks and workflow-scenario limitations; no live model-quality eval is claimed.

The normal terminal command was retried during this repair and still rejects
with `Repo-task mutation requires the active workflow runtime`. The task remains
open pending the runtime-authorized transition in this writer workspace.
