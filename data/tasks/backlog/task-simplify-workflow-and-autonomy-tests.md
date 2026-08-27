---
id: task-simplify-workflow-and-autonomy-tests
title: Simplify workflow and autonomy behavior verification
status: backlog
priority: p1
area: autonomy
summary: Track core runtime ownership, autonomy decision extraction, and per-workflow migration separately.
task_class: Meta
anchor: true
created_at: 2026-08-26T23:54:21.238Z
updated_at: 2026-08-27T00:45:00.000Z
---
## Outcome

Core workflow runtime behavior is proved once; autonomy workflows own semantic decisions and published outcomes without pinning private phases, prompt strings, helper order, command calls, or production-shaped fixtures.

## Tracked Slices

- [ ] task-consolidate-core-workflow-runtime-verification
- [ ] task-extract-autonomy-decision-owners
- [ ] task-migrate-autonomy-workflow-families

## Done When

All three slices are complete and no autonomy workflow copies core lifecycle matrices or depends on a shadow runtime or universal mega-fixture.

## Initiative

Lean behavioral verification and trustworthy self-improving automation.
