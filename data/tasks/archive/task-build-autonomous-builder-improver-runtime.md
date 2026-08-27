---
status: done
---

# Build autonomous builder and improver runtime

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
