---
status: open
priority: p1
---

# Promote higher value backlog work before ready queue exhaustion

## Problem

Product-aware ranking exists inside backlog promotion, but the dispatcher emits
`autonomy.queue.needs-promotion` only when `actionableCount === 0`. As long as
one ready task exists, the builder selects only from ready work and the
promoter never compares that work with promotable backlog tasks.

The 2026-08-13 through 2026-08-15 run demonstrates the consequence: all 30
builders worked on Safety, Platform, or Meta tasks, while six P1 Product tasks
remained in backlog and P2 review-generated tasks remained actionable in
ready. The ranking policy was not wrong; it was never invoked across the state
boundary where the competing work lived.

## Desired Outcome

Make one canonical selection decision across actionable ready work and
promotable backlog work. Queue state remains meaningful: ready is still the
short execution queue and backlog is still the reserve. Before dispatch, queue
shaping may promote a better candidate or decline with a recorded comparison.
Existing priority, task-class, dependency, runtime-admission, runtime-posture,
and Product/Safety-link policies remain the ranking inputs.

## Constraints

- Reuse the canonical repo-task snapshot and backlog promotion ranking. Do not
  add a second scheduler, priority store, fixed Product quota, round robin, or
  periodic promotion run.
- Do not promote the whole backlog or continuously churn task files. Maintain a
  short ready queue and mutate it only when the selected execution frontier
  would materially improve.
- P0 runtime and Safety work must remain able to outrank Product work. Ordinary
  lower-priority Meta and review-generated work must not hide higher-priority
  Product or Safety work merely because it entered ready first.
- Preserve dependencies, unavailable runtime resources, blocked conditions,
  owner decisions, and the existing runtime-posture exception.
- A repeated unchanged queue revision must be a no-op before workflow dispatch.

## Done When

- The dispatcher or its single queue-shaping owner compares ready and
  promotable backlog candidates before emitting builder work.
- A fixture with P2 ready review work and a promotable P1 Product task selects
  the Product task without first draining ready to zero.
- Fixtures preserve P0 runtime/Safety precedence, dependency and resource
  blocking, same-priority Product/Safety preference, and a genuinely better
  ready candidate.
- Replaying the audited queue produces an explicit rationale for the selected
  frontier and no repeated promotion commits on the same queue revision.
- Operator status identifies the next selected task and why a higher-ranked
  backlog candidate was or was not promoted.

## Source / Intent

Owner-requested productivity audit on 2026-08-16. Existing
`task-add-product-aware-autonomy-governance` correctly defined the ranking, but
live dispatch proved that state-gated promotion prevents that policy from
seeing all eligible work.

## Initiative

Product-aware autonomous delivery.

## Product / Safety Link

This Meta repair directly prevents lower-value review and process work from
starving higher-priority Product and Safety tasks while retaining urgent
runtime and security precedence.

## Acceptance Evidence

- A before/after replay of the audited ready/backlog snapshot with selected and
  rejected candidates, ranking factors, and task-state mutations.
- Focused queue-routing fixtures proving useful promotion and unchanged-revision
  no-op behavior through the production dispatcher path.
