---
id: task-refactor-runtime-health-audit
title: refactor runtime-health-audit
status: ready
priority: p3
area: autonomy
task_class: Platform
summary: Split the oversized runtime health audit module while preserving behavior.
created_at: 2026-06-19T16:16:47.718Z
updated_at: 2026-06-19T16:16:47.718Z
---

## Problem

`src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit.ts` is currently 1015 lines. Runtime health audit logic is too concentrated, making future autonomy assessment and repair work harder to review.

## Desired Outcome

Split runtime health audit responsibilities into smaller units while preserving audit behavior, artifact shape, and public entry points.

## Constraints

- Preserve public exports and runtime artifact schema unless a migration is explicitly documented.
- Keep audit behavior stable; this is a refactor, not a policy rewrite.
- Read the nearest workflow `AGENTS.md` before editing.
- Avoid broad build/lint/test sweeps as acceptance evidence; prefer static queries and focused probes.

## Done When

- The original file is materially smaller and responsibilities are separated.
- Audit collection, interpretation, and report/artifact formatting are not tangled in one large block.
- Static queries show no orphaned audit helpers or duplicate report paths.
- Existing callers and artifact consumers remain compatible.

## Source / Intent

Owner follow-up on 2026-06-19: large autonomy workflow files should be turned into explicit agent tasks so future self-improvement work stays reviewable.

## Initiative

N/A - scoped maintenance.

## Acceptance Evidence

- Include `wc -l` before/after for `src/modules/autonomy/workflows/autonomy-health-reviewer/runtime-health-audit.ts`.
- Include static query output proving public exports and artifact consumers are preserved.
- Include a focused fixture or sample audit artifact comparison if one exists locally.
