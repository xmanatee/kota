---
id: task-workflow-run-causedby-chain
title: Add causal chain traversal to workflow run history CLI
status: done
priority: p3
area: cli
summary: The web UI can show triggered child runs and parent run links for a given run, but the CLI has no equivalent. kota workflow history and kota workflow show have no way to display or follow the causedBy/triggeredRuns chain, making it hard to trace a multi-workflow pipeline from the terminal.
created_at: 2026-04-02T08:57:28Z
updated_at: 2026-04-02T10:06:24Z
---

## Problem

When a trigger step fires a child workflow, the child run's `causedBy` field records the parent. The web UI `client-run-detail.ts` renders "Triggered by:" and "Triggered runs:" links that let operators navigate the chain. The CLI has no equivalent.

Operators who prefer the terminal or who script against `kota` have no way to follow a multi-workflow pipeline (e.g., builder → notifier → PR checker) from a single command. They must resort to reading raw `.kota/runs/` JSON or switching to the web UI.

## Desired Outcome

`kota workflow show <run-id>` (or `kota workflow history --run <id>`) gains a `--chain` flag that:

1. Fetches the run detail for the given run ID.
2. Follows `causedBy` upward to the root run.
3. Lists child runs triggered by this run (via daemon API `GET /api/workflow/runs?causedByRunId=<id>`).
4. Prints the full causal chain as a compact tree:

```
root: builder/2026-04-01T10-00-00Z (success, 4m12s)
  └─ my-extension/notifier/2026-04-01T10-04-15Z (success, 8s)
       └─ my-extension/pr-checker/2026-04-01T10-04-24Z (failed, 1m02s)  ← current
```

Without `--chain`, behavior is unchanged.

## Constraints

- Only use the existing daemon API endpoints; do not add new server routes for this task.
- The tree depth should be bounded (max 5 levels) to prevent runaway traversal.
- When the daemon is offline, fall back gracefully with a clear message rather than crashing.
- Keep the CLI output compact; do not replicate the full run detail at each node.

## Done When

- `kota workflow show <run-id> --chain` prints the causal chain tree.
- Root, current node, and child runs are all included.
- Tree depth is bounded and documented in `--help`.
- Works both when daemon is running (API path) and when offline (direct `.kota/runs/` read with degraded output).
