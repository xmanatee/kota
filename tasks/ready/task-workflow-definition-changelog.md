---
id: task-workflow-definition-changelog
title: Surface workflow definition change history in CLI and web UI
status: ready
priority: p3
area: operator-ux
summary: When the builder modifies a workflow definition, operators have no easy way to see what changed and when. Surfacing git history for workflow definition files would let operators audit autonomous changes to their automation layer without manually running git log.
created_at: 2026-04-01T11:02:00Z
updated_at: 2026-04-02T00:00:00Z
---

## Problem

KOTA's builder can autonomously modify workflow definition files (`.ts` files under the `workflows/` or operator-configured directory). These changes land directly in git, but the operator has no in-product surface to see what the builder changed and when. Auditing autonomous changes to the automation layer currently requires running `git log -- <file>` by hand.

There is no `kota workflow definition-log <workflow-name>` command and no web UI panel showing definition change events.

## Desired Outcome

A `kota workflow definition-log <workflow-name>` CLI command (or `kota workflow log`) that:
- Locates the workflow definition file using the same resolution logic as the daemon.
- Runs `git log --oneline -- <file>` and presents the commit history with timestamp, commit hash, and message.
- Supports `--diff` flag to show the actual definition diff for each commit.

Optionally, surface the most recent 3 definition commits in the web UI workflow details panel.

## Constraints

- Use `git log` output via `child_process.execSync`; do not introduce a git library.
- Fail gracefully if the workflow definition file is not tracked by git (print a message, exit 0).
- The `--diff` flag should show unified diff of the definition file across commits, not the full repo diff.
- Do not add a new daemon API endpoint for this; it is a local CLI operation.

## Done When

- `kota workflow definition-log <workflow-name>` prints the git commit history for the workflow's definition file.
- `--diff` flag shows the file diff for each commit.
- If the file is not git-tracked, the command prints an informative message instead of erroring.
- The command appears in `kota workflow --help`.
- Type-checking and linting pass.
