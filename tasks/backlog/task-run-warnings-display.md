---
id: task-run-warnings-display
title: Surface run warnings in kota workflow run show and web UI run detail
status: backlog
priority: p3
area: operator-ux
summary: When a run completes with status completed-with-warnings, the structured warnings (e.g. outputSchema mismatch) are stored in the run artifact but never shown in the CLI or web UI, leaving operators without actionable detail.
created_at: 2026-04-02T00:00:00Z
updated_at: 2026-04-02T00:00:00Z
---

## Problem

`WorkflowRunMetadata` has an optional `warnings` field (type `WorkflowRunWarning[]`,
defined in `src/workflow/run-types.ts`) that is written to the run artifact when a run
finishes with status `completed-with-warnings`. Currently the only way a warning is
generated is an `outputSchema` mismatch (`type: "output-schema-mismatch"`).

Neither the daemon control API response (`src/scheduler/daemon-control-types.ts`), nor
`kota workflow run show` (`src/workflow-cli/run-show.ts`), nor the web UI run detail
panel (`src/web-ui/client-run-detail.ts`) exposes these warnings. An operator who sees
the ⚠ status icon in the run list has no in-product path to learn what the warning says
without manually reading the raw `.kota/runs/<id>/metadata.json` file.

## Desired Outcome

- `kota workflow run show` prints a `Warnings:` section listing each warning message
  when the run metadata contains warnings.
- The web UI run detail panel shows the same warnings inline below the run status when
  `completed-with-warnings`.
- The daemon `/workflow/runs/:id` endpoint includes `warnings` in the response so the
  CLI and web UI can read it without falling back to the filesystem.

## Constraints

- Only display when `warnings` is non-empty. Do not add a section for runs with no
  warnings.
- The daemon API change adds `warnings?: Array<{ type: string; message: string }>` to
  the existing run detail response shape; no new endpoint needed.
- Offline path (`kota workflow run show` reading metadata directly from disk) must also
  display warnings.
- Do not change the warning storage format in the run artifact.

## Done When

- `kota workflow run show` outputs a warnings section for a run that has warnings.
- The web UI run detail panel renders warnings when present.
- The daemon `/workflow/runs/:id` endpoint includes the warnings array.
- A unit test in `run-show.test.ts` covers the warnings display path.
- Type-checking and linting pass.
