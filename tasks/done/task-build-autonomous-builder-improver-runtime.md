---
id: task-build-autonomous-builder-improver-runtime
title: Build autonomous builder and improver runtime
status: done
priority: p1
area: workflow
summary: Replace the old shell loop with a daemon runtime that runs builder and improver workflows and persists run state.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

The old shell-loop setup was too rigid and not aligned with the repo’s event-
driven workflow direction.

## Desired Outcome

KOTA should run autonomous builder and improver workflows through the daemon,
with persisted state, per-run artifacts, and restart continuity.

## Constraints

- Keep workflows explicit and typed.
- Persist enough state to recover cleanly after restart.
- Avoid reviving the old shell-loop path.

## Done When

- Builder and improver run through the daemon workflow runtime.
- Per-run artifacts live under `.kota/runs/`.
- Restart recovery preserves queued follow-up workflow execution.
