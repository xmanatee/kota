---
id: task-separate-task-queue-structure-from-autonomy-govern
title: Separate task queue structure from autonomy governance
status: backlog
priority: p2
area: architecture
task_class: Platform
depends_on: [task-make-taskclaim-the-sole-active-work-authority]
summary: Keep repo-task validation structural and move promotion, strategic coverage, architecture-debt, and replacement-proof policy to their owning layers.
created_at: 2026-08-24T02:13:47.810Z
updated_at: 2026-08-24T02:13:47.810Z
---

## Problem

`task-queue-validation.ts` mixes task schema/path/dependency validation with
autonomy prioritization, strategic ready coverage, documentation wording,
architecture-debt detection, Git status, completion evidence, and production
replacement execution. Repo-task structure and autonomous queue governance
therefore change through one 1,200-line policy file.

## Desired Outcome

Keep the repo-tasks module authoritative for task schema, state, dependency,
safe file access, and transition invariants. Move promotion/readiness strategy
to autonomy, architecture fitness rules to the architecture check, and
production replacement execution to a focused proof service consumed by task
transitions.

## Constraints

- Do not weaken any current validation or create separate task schemas.
- Queue structure remains deterministic and available without loading
  autonomy workflows.
- Promotion and strategic coverage consume the typed task-domain projection;
  they do not reread task files or reproduce actionability calculations.
- The production replacement proof remains a required task-transition gate,
  but its execution/resource policy has one focused owner.
- Move callers and focused tests before deleting mixed validation branches; no
  compatibility re-export file remains.

## Done When

- Repo-task validation covers only structural/task-domain invariants and
  delegates exact transition proof through typed services.
- Autonomy owns prioritization, coverage, and promotion policy.
- Architecture checks own source-layout and single-mechanism enforcement.
- Validation output and exit behavior remain stable or improve through one
  composed command without a second task validator.
- The mixed-responsibility implementation is removed and each rule has one
  source-level owner.

## Source / Intent

Owner-approved targeted rewrite from the 2026-08-24 audit. The current task
validator remains valuable; the problem is that unrelated product and autonomy
policy accumulated in its structural boundary.

## Initiative

One task schema and clear task/autonomy/architecture ownership.

## Acceptance Evidence

- Before/after task-validation corpus covering valid and invalid queues,
  dependencies, transitions, strategic coverage, and replacement proof.
- Import/ownership report mapping every former rule to exactly one component.
- Standard `pnpm validate-tasks` transcript proving the composed public command
  remains the single entry point.
