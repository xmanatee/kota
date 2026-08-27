---
status: done
---

# Add product aware autonomy governance

## Problem

Autonomous workflows can spend too much attention on internal repair,
evaluator drift, fan-out consolidation, and meta-process tasks while P1
owner-visible Product work remains backlog or blocked. The current reporting
and critic gates do not make "green tests but unchanged operator UX" a clear
failure mode.

## Desired Outcome

Builder, improver, decomposer, progress-reviewer, critic, and repair
escalation should use `task_class` and rendered evidence policy to prefer
Product/Safety outcomes and restrict Meta work to visible blockers.

## Constraints

- Do not cap autonomy by default; fix queue shaping and review gates instead.
- Do not suppress Safety/P0/runtime failure repair.
- Do not require rewriting every historical task.
- Keep classification inspectable in run artifacts and operator reports.

## Done When

- Builder/decomposer selection prefers P1 Product/Safety over Meta work unless
  the runtime or Safety posture is broken.
- Critic rejects Product tasks that pass tests but lack required operator
  journey evidence.
- Progress-reviewer reports Product/Safety/Platform/Meta distribution and flags
  green-test/unchanged-UX outcomes.
- Workflow-failure escalation consolidates repeated same-root-cause repair
  tasks instead of fanning out duplicates.

## Source / Intent

Owner request on 2026-06-11: KOTA appears to optimize and repair itself while
the simple product surfaces remain weak and some tasks look done before the
experience is actually complete.

## Initiative

KOTA product-aware autonomy governance.

## Acceptance Evidence

- Queue governance test coverage in
  `src/modules/autonomy/workflows/backlog-promoter/promotion.test.ts` shows
  same-priority Safety/Product work outranking ordinary Meta work, and
  generated runtime-posture repair work outranking same-priority
  Safety/Product work.
- Improver governance test coverage in
  `src/modules/autonomy/workflows/improver/task-governance.test.ts` and
  `src/modules/autonomy/workflows/improver/workflow.test.ts` shows the
  workflow receives task-class balance, actionable Meta link gaps, and done
  Product tasks without operator-journey evidence.
- Critic test coverage in `src/modules/autonomy/critic.test.ts` rejects a
  `task_class: Product` task when mocked implementation checks would pass but
  no operator-journey artifact exists.
- Workflow-failure escalation tests in
  `src/modules/autonomy/workflow-failure-escalation.test.ts` show repeated
  repair warnings and failures with the same root cause sharing one repair
  task id.
- `.kota/runs/2026-06-18T22-10-55-014Z-builder-gglikl/kota-report-transcript.txt`
  captures `kota report` output with `By task_class` distribution for open and
  done tasks.

## Result

Product-aware governance now has deterministic queue ranking with a
runtime-posture repair exception, improver task-governance evidence, critic
evidence gating, progress-review/report task-class distribution, and
root-cause keyed failure repair consolidation.
