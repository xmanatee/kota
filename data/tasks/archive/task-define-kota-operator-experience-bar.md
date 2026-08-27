---
status: done
---

# Define KOTA operator experience bar

## Problem

KOTA had strong internal architecture and validation, but no concise durable
operator bar that forced autonomous work to prioritize visible human control
surfaces over internal meta-work. That let green tests, repair loops, and
protocol slices look complete while CLI, daemon status, blocked asks, and
client UX still felt confusing to the owner.

## Desired Outcome

KOTA's durable instructions state that owner-visible Product and Safety work
outranks Meta/repair work, and that CLI/client/operator tasks are only complete
when the actual operator journey is proven by rendered evidence.

## Constraints

- Keep this as high-level policy, not a changelog or roadmap document.
- Use existing task queue validation rather than inventing a parallel planning
  surface.
- Do not force all historical tasks to grow new metadata just to land this bar.

## Done When

- `docs/STANDARDS.md` records the operator-first product bar and rendered
  evidence requirement.
- `data/tasks/AGENTS.md` defines `task_class` and the actionable Meta-task
  Product/Safety link rule.
- `src/modules/autonomy/AGENTS.md` tells critic/reviewer flows to judge Product
  work by operator evidence, not only diff/tests.
- The queue validator accepts the new classes and rejects actionable Meta work
  that does not name the Product/Safety blocker it closes.

## Source / Intent

Owner request on 2026-06-11: KOTA feels like it is doing too much bloat,
micro-optimization, and internal repair while the simple product contract and
human UX remain weak.

## Initiative

KOTA operator-first recovery roadmap.

## Acceptance Evidence

- `pnpm validate-tasks` passes with `task_class` metadata in the new roadmap tasks.
- `pnpm test src/modules/repo-tasks/task-queue-validation.test.ts` covers valid
  classes and the actionable Meta Product/Safety link gate.
