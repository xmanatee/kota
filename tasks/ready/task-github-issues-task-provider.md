---
id: task-github-issues-task-provider
title: Add GitHub Issues task provider so teams can use their issue tracker as KOTA's task source
status: ready
priority: p2
area: extensions
summary: Add a TaskProvider implementation backed by GitHub Issues so teams can use their existing issue tracker as KOTA's task source without maintaining a parallel task queue.
created_at: 2026-04-02T01:18:54Z
updated_at: 2026-04-08T19:43:33Z
---

## Problem

KOTA's `TaskProvider` interface supports pluggable task stores, but only the file-based
provider ships by default. Teams that already manage work in GitHub Issues must either
maintain a duplicate task queue in `tasks/` or manually mirror issues into task files
before the builder can pick them up. This creates friction and makes it easy for the
two sources to drift out of sync.

The GitHub extension already has an authenticated REST API client and understands the
repo context. A thin task provider layer on top of that client would let teams wire
KOTA directly to their GitHub backlog with no parallel queue maintenance.

## Desired Outcome

- The GitHub extension optionally contributes a `TaskProvider` when
  `config.extensions.github.taskProvider` is enabled.
- **Claim**: adds an `in-progress` label to the issue (or a label configured by the operator).
- **Complete**: closes the issue or adds a completion label (`kota-done` by default).
- **List**: returns open, unclaimed issues matching the configured label filter (e.g. `kota-task`).
- Priority and area are derived from issue labels via a configurable mapping
  (e.g. `p2`, `area:cli` labels map to KOTA fields).
- Configured entirely via `config.extensions.github`:
  ```json
  {
    "taskProvider": {
      "enabled": true,
      "labelFilter": "kota-task",
      "inProgressLabel": "in-progress",
      "doneLabel": "kota-done",
      "priorityLabels": { "p0": "priority:critical", "p1": "priority:high", "p2": "priority:medium", "p3": "priority:low" },
      "areaLabels": { "cli": "area:cli", "runtime": "area:runtime" }
    }
  }
  ```

## Constraints

- Uses the existing GitHub REST API client in the GitHub extension — no new npm deps.
- GitHub is the authoritative source; no local task file creation or mirroring.
- Two-way sync (push local tasks to GitHub) is out of scope.
- Provider registers via the `ProviderRegistry` the same way the file-based provider does.
- Disabled gracefully (provider not registered) when `taskProvider.enabled` is false or absent.
- Does not modify core `TaskProvider` interface or file-based provider behavior.

## Done When

- GitHub task provider registers as `TaskProvider` when `github.taskProvider.enabled: true`.
- Builder can list, claim, and complete GitHub issues as tasks in a configured repo.
- Priority and area fields populated from labels via configurable mapping (defaults reasonable when mapping absent).
- Existing file-based task provider tests unaffected.
- Unit or integration test covers list (with label filter), claim (label add), and complete (issue close).
