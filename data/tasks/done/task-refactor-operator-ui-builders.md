---
id: task-refactor-operator-ui-builders
title: refactor operator-ui-builders
status: done
priority: p3
area: modules
task_class: Platform
summary: Split the oversized operator UI builders module while preserving behavior.
created_at: 2026-06-19T16:16:35.672Z
updated_at: 2026-06-20T18:56:02.243Z
---

## Problem

`src/modules/daemon-ops/operator-ui-builders.ts` is currently 1936 lines. It is one of the changed production files called out by the autonomy assessment as too large to keep clean during repeated agent work.

## Desired Outcome

Split the module into coherent helpers or submodules with clear ownership while preserving the public exports and rendered/operator-facing behavior.

## Constraints

- Preserve existing public exports and import paths unless a compatibility shim is added.
- Keep behavior changes out of this refactor except for fixes required to preserve behavior after extraction.
- Read the nearest `AGENTS.md` before touching the module directory.
- Avoid creating another oversized catch-all file.

## Done When

- The original file is materially smaller and no longer mixes unrelated builder responsibilities.
- Extracted modules have clear names and no circular ownership.
- Existing callers continue to import the same public API or an explicitly compatible replacement.
- Static queries show no orphaned imports, dead extracted files, or duplicate builder implementations.

## Source / Intent

Owner follow-up on 2026-06-19: large files from the assessment are scary and should become explicit refactor work for autonomous agents instead of being manually implemented in this turn.

## Initiative

N/A - scoped maintenance.

## Acceptance Evidence

- Include `wc -l` before/after for `src/modules/daemon-ops/operator-ui-builders.ts`.
- Include `rg` output or another static query proving public exports/callers are preserved.
- Include any focused fixture, transcript, or targeted check used to verify operator-facing behavior.

## Result

Completed in run `.kota/runs/2026-06-20T18-42-46-982Z-builder-laibg5/`. The builder file now re-exports the stable public surface from named helper/surface modules; line-count, caller/export queries, focused daemon-ops UI tests, typecheck, lint, task validation, and the bounded UI audit are recorded in the run artifacts.
