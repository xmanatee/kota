---
status: open
priority: p1
---
# Settle gardener decisions against relevant evidence

## Problem

Follow-up to archived task-make-the-architecture-gardener-an-evidence-led-age
(de1449038), not another gardener. The agent, scoped request path and removal of
fabricated scoring are useful. Two live-contract gaps remain.

admission.ts fingerprints all structural observations and delivery follow-ups;
any changed delivery counter can admit unchanged architectural evidence when
both kinds exist. Eight inspected Sept 9-10 runs had unchanged non-delivery
fingerprints; five invoked an agent, yielding one no-action and four covered
decisions. Exact JSON equality is not meaningful new information.

gardener-task.ts returns an existing generated task unchanged even when it is
terminal and the decision proposes new work. workflow.ts can record proposed
and consume the cohort despite touchedTaskQueue=false. A decision is not a
delivered task, and a done task is not automatically coverage of new evidence.

## Desired Outcome

Use existing review state and generated-work/task publication owners to retain a
settled judgment and its relevant revisit condition. New structural evidence or
materially changed delivery friction can warrant review; unrelated incident
increments do not automatically invalidate it. Permit explicit justified review,
false-positive rejection and no-action. Do not introduce scores, count thresholds,
another scheduler or a general semantic-equivalence engine.

Make proposal settlement truthful: distinguish unchanged/covered, an applied
update or authorized reopen, and deferred publication against an active owner.
New validated evidence may reopen the relevant terminal task with explicit
priority using the existing task lifecycle, not silently create duplicate work.
Consume proposal evidence only with a durable truthful disposition. Preserve the
existing ownership and integration contracts; do not mutate a held task directly.

## How We Will Know

At the existing owner boundary, unchanged structural evidence plus irrelevant
friction churn does not repeat investigation, meaningful change admits once,
and a new proposal against terminal/active tasks is applied or honestly deferred.
One live grounded decision links to the actual task mutation or justified no-op.
Review all callers of the common generated-work materializer before changing it;
test shared lifecycle behavior there, not repeatedly in every workflow.