---
id: task-workflow-cli-inspect
title: Finish workflow CLI inspect error display
status: ready
priority: p2
area: cli
summary: `kota workflow show` does not reliably surface stored run-level errors for failed runs because the command reads `error.txt` through the JSON reader. Small, narrow fix — promoted to ready now that architecture cleanup has settled.
created_at: 2026-03-20
updated_at: 2026-03-27
---

## Problem

The `kota workflow` CLI surface exists, but `kota workflow show` does not reliably surface stored run-level errors for failed runs. The current implementation reads `.kota/runs/<runId>/error.txt` through the JSON reader, so plain-text errors are skipped.

## Desired Outcome

- `kota workflow show <run-id>` displays the run-level error text when `.kota/runs/<runId>/error.txt` exists.
- Failed runs remain debuggable from the CLI without dropping to the filesystem.
- The existing list/status/show surface stays otherwise unchanged.

## Constraints

- Keep the fix narrow to the inspect path.
- Use the existing run directory layout; no new persistence or metadata fields.
- Do not regress the existing list/status/show output.

## Done When

- `kota workflow show <run-id>` prints the stored run-level error when `error.txt` is present.
- A focused test covers the plain-text error path.
- Existing workflow CLI behavior remains intact.
