---
id: task-normalize-ticket-json
title: Normalize ticket JSON for release routing
status: ready
priority: p2
area: modules
summary: Read data/tickets/T-1042.json and write output/ticket-summary.json with the canonical validity and routing fields, then move this task to done.
created_at: 2026-05-29T00:00:00.000Z
updated_at: 2026-05-29T00:00:00.000Z
---

## Problem

The ticket fixture needs a deterministic JSON normalization result.

## Desired Outcome

Write `output/ticket-summary.json` with `valid: true` and
`routing: "release"` when the ticket is paid, manager-approved, low risk,
and requests release.

## Done When

- `output/ticket-summary.json` exists with the canonical release routing.
- This task is moved to `data/tasks/done/`.
