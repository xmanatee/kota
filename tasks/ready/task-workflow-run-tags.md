---
id: task-workflow-run-tags
title: Add operator-assignable tags to workflow runs for filtering and grouping
status: ready
priority: p3
area: operator-ux
summary: Workflow runs are identified by ID and workflow name, but operators have no way to annotate runs with custom tags (e.g. "release-v2", "debug", "customer-abc"). Tags would enable filtered views in kota workflow list and the web UI without requiring separate workflow definitions.
created_at: 2026-03-31T08:31:48Z
updated_at: 2026-03-31T15:07:46Z
---

## Problem

`WorkflowRunMetadata` in `src/workflow/run-types.ts` captures trigger, status, cost, and timing but has no user-defined annotation fields. Operators who run the same workflow for different contexts (e.g., different customers, release stages, experiment IDs) must use separate workflow definitions or read run logs to distinguish runs post-hoc.

`kota workflow list` has `--workflow` and `--status` filters but no `--tag` filter.

## Desired Outcome

- `WorkflowRunMetadata` gains an optional `tags: string[]` field (default `[]`).
- `kota workflow trigger <name> --tag <tag>` (repeatable) attaches tags at trigger time.
- `kota workflow list --tag <tag>` filters runs to those with the given tag.
- The web UI run list shows tags as small badges next to the workflow name.
- Tags are persisted in `metadata.json` alongside other run metadata.

## Constraints

- Tags are strings only — no key-value pairs needed at this stage.
- Tags at trigger time only; no retroactive tag editing.
- No new daemon API endpoints needed if tags can be passed as trigger payload.
- Backward compatible: existing runs with no tags field continue to work.

## Done When

- `--tag` flag works on `kota workflow trigger`.
- `--tag` filter works on `kota workflow list`.
- Tags appear in `kota workflow show <id>` output.
- Tags are persisted in `metadata.json`.
- Existing run store tests pass.
