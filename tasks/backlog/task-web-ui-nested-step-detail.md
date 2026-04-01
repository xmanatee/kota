---
id: task-web-ui-nested-step-detail
title: Show foreach iteration and branch substep detail in web UI run detail
status: backlog
priority: p3
area: operator-ux
summary: The web UI run detail renders steps as a flat list. Foreach iterations and branch substeps are collapsed into a single step row with no way to inspect per-iteration or per-branch step results, making it hard to diagnose failures in these compound steps.
created_at: 2026-04-01T09:21:00Z
updated_at: 2026-04-01T09:21:00Z
---

## Problem

`foreach` and `branch` steps were recently added to the workflow DSL. Both produce nested
step results: foreach records N iterations each with their own substeps, and branch records
which path (ifTrue or ifFalse) ran along with any substep results. The web UI run detail
(`client-run-detail.ts`) renders all steps as a flat list; compound step output is shown
only as raw JSON, not as structured sub-rows. Operators debugging a foreach that failed on
iteration 3 of 10 must read raw JSON output rather than inspecting a clear per-iteration
breakdown.

## Desired Outcome

The web UI run detail expands compound step rows to show inner structure:

- **Foreach step**: a collapsible section under the step row showing N iteration rows,
  each with its own status badge and per-substep detail (id, status, duration).
- **Branch step**: shows which branch ran (true/false) and any substep rows within
  the chosen branch.

On success the expansion is collapsed by default; on failure it auto-expands to the
failed iteration or branch.

## Constraints

- Keep changes inside `src/web-ui/client-run-detail.ts`; no new files or build dependencies.
- The flat list rendering for non-compound steps must be unchanged.
- Iteration data is available in the step's `output` field as stored by the run executor;
  read the existing stored shape before deciding a render structure.
- Expanding/collapsing can use a simple click-to-toggle pattern consistent with the
  existing thinking-block expand pattern in the same file.

## Done When

- Foreach step rows show a per-iteration breakdown with status and substep summary.
- Branch step rows show which branch ran and any substep results.
- Non-compound steps render identically to today.
- Existing web UI tests pass.
