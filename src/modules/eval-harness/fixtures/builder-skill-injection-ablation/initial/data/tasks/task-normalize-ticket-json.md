---
status: open
priority: p2
---

# Normalize ticket JSON for release routing

## Problem

The ticket fixture needs a deterministic JSON normalization result.

## Desired Outcome

Write `output/ticket-summary.json` with `valid: true` and
`routing: "release"` when the ticket is paid, manager-approved, low risk,
and requests release.

## Done When

- `output/ticket-summary.json` exists with the canonical release routing.
- This task is moved to `data/tasks/archive/`.
