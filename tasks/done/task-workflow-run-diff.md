---
id: task-workflow-run-diff
title: Add workflow run comparison (diff) to CLI and web UI
status: done
priority: p3
area: operator-ux
summary: Operators can view individual run details but have no way to compare two runs side-by-side — e.g., to understand why a builder run cost more than yesterday's. A diff view showing changed step durations, costs, and outputs would close this gap.
created_at: 2026-03-31T07:37:58Z
updated_at: 2026-03-31T12:22:00Z
---

## Problem

`kota workflow show <id>` and the run-detail panel in the web UI display a single run in isolation. When a builder run takes 40% longer than usual, or a cost spike appears in the workflow stats, operators must manually compare two `metadata.json` files to find the cause. There is no built-in comparison surface.

## Desired Outcome

Two surfaces for run comparison:

1. **CLI**: `kota workflow diff <run-id-a> <run-id-b>` prints a side-by-side table of step-level differences — duration delta, cost delta, status change — and highlights any step that regressed.
2. **Web UI**: A "Compare" button on the run-detail panel that opens a second run selector, then renders the same diff table inline beneath the step list.

Both surfaces compare: step names, statuses, durations, and cost. They do not diff step outputs (artifact content) in v1.

## Constraints

- CLI diff reads from `.kota/runs/` directly (no daemon required).
- Web UI diff should use the existing `GET /workflow/runs/:id` endpoint; no new daemon route needed.
- Step output content diff is explicitly out of scope for v1.
- CLI output should be readable in a standard 80-column terminal without wrapping.
- No new npm dependencies for the CLI path.

## Done When

- `kota workflow diff <id-a> <id-b>` prints a step-level diff table showing duration and cost deltas.
- Web UI run-detail panel shows a comparison view when two runs are selected.
- Both surfaces handle runs from different workflows gracefully (show "N/A" for steps present in one but not the other).
- At least one test covers the CLI diff logic (snapshot or assertion-based).
