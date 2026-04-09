---
id: task-run-artifacts-lifecycle
title: Add run artifact retention policy and compaction for .kota/runs/
status: done
priority: p3
area: runtime
summary: .kota/runs/ grows unboundedly — each workflow run writes artifacts that are never cleaned up. At hundreds of runs and counting, operators have no policy control over retention, and disk usage will grow indefinitely without intervention.
created_at: 2026-03-30T16:58:10Z
updated_at: 2026-03-30T17:10:57Z
---

## Problem

Every workflow run writes an artifact directory under `.kota/runs/<run-id>/`.
Nothing cleans these up. The autonomous loop fires on a 30-second idle trigger,
so artifact directories accumulate rapidly.

Two related concerns:
1. **Disk usage** — run artifacts (step outputs, commit messages, metadata)
   accumulate with no retention limit.
2. **Query performance** — `kota workflow runs` (task-workflow-run-history-cli)
   scans `.kota/runs/` on every invocation; 1,000+ directories will make
   listing noticeably slow without an index or a bounded scan.

There is no existing cleanup mechanism, no configuration option for retention,
and no documentation of expected artifact lifecycle.

## Desired Outcome

- A configurable retention policy (e.g., keep last N runs, or keep runs newer
  than D days; default keep-last-500).
- A cleanup mechanism: a `kota workflow runs gc` subcommand and/or a periodic
  workflow step that prunes old artifact directories.
- Policy is configurable in `.kota/config` or another operator-accessible
  location.
- The `kota workflow runs` listing remains fast as artifact count grows.

## Constraints

- Never delete a run directory that is currently in progress; check active run
  IDs from the daemon if running before pruning.
- Default policy must be conservative — do not delete anything unless the
  operator explicitly configures retention or runs gc.
- Keep the compaction path separate from the read path so listing is not
  blocked by cleanup work.
- Prefer an explicit triggered command or workflow step over a background
  compaction thread in the daemon.

## Done When

- A retention policy configuration is documented and settable.
- `kota workflow runs gc` (or equivalent) prunes runs outside the policy window.
- Active runs are never touched during pruning.
- `kota workflow runs` list performance is acceptable at 1,000+ run directories.
