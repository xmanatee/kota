---
id: task-resolve-current-workflow-dead-letters
title: Resolve current workflow dead letters
status: done
priority: p1
area: autonomy
summary: Clear or redrive the five open KOTA workflow-dispatch DLQs after recent promotion and progress-reviewer fixes, preserving diagnostics and creating narrower repair tasks for any failure that still reproduces.
created_at: 2026-06-26T06:20:49.216Z
updated_at: 2026-06-26T06:29:57.481Z
---

## Problem

Clear or redrive the five open KOTA workflow-dispatch DLQs after recent promotion and progress-reviewer fixes, preserving diagnostics and creating narrower repair tasks for any failure that still reproduces.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-26T05-00-00-046Z-progress-reviewer-38msjz.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-26T05-00-00-046Z-progress-reviewer-38msjz.

review verdict: needs-steering
review summary: Needs steering: balance is Product 2, Safety 2, Platform 11, Meta 5, Unclassified 1. Recent Safety/Product/Platform work is landing, but five open workflow-dispatch dead letters still include queue-validation, progress-reviewer, and builder failures that need cleanup or redrive before the scope is healthy.

Evidence ids:

- scope:8nrg1m:dead-letter:dlq-3fcbceec-b87e-4a6f-8def-52144fa293d0
- scope:8nrg1m:dead-letter:dlq-c1692b3f-1b02-40c2-924f-d8265227b28a
- scope:8nrg1m:dead-letter:dlq-56954c1a-f782-4621-a60a-b4cbd0b65594
- scope:8nrg1m:dead-letter:dlq-69cc8506-8836-448b-936a-db2fcdd96ebe
- scope:8nrg1m:dead-letter:dlq-ab90647f-843d-4cdb-ad88-e9d418342844

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- `.kota/runs/2026-06-26T06-22-55-603Z-builder-tmg2wp/dlq-resolution-summary.md` records before/after DLQ state, per-item dismissal rationale, loop-quality task state, focused progress-reviewer test evidence, and queue validation evidence.
- The cited DLQ ids were exported before and after dismissal under `.kota/runs/2026-06-26T06-22-55-603Z-builder-tmg2wp/dlq-diagnostics/`.
- `pnpm kota workflow dlq list --status open --json` returned `items: []` and `counts.open: 0`.
- `pnpm exec vitest run src/modules/autonomy/workflows/progress-reviewer/workflow.test.ts -t "keeps tasks referenced by dead-letter reasons citeable" --reporter=dot` passed.
- `pnpm run validate-tasks` passed after the task move was staged.
