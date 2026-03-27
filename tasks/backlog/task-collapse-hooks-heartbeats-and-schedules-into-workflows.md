---
id: task-collapse-hooks-heartbeats-and-schedules-into-workflows
title: Collapse hooks, heartbeat work, and schedules into the workflow surface
status: backlog
priority: p1
area: workflow
summary: Workflow triggers now cover event, cron, interval, and idle work, but extensions and manifests can still wire direct event-bus reactions outside the workflow model. Finish collapsing those lower-level paths so workflows are the one public automation surface.
created_at: 2026-03-26
updated_at: 2026-03-26
---

## Problem

KOTA already has the ingredients for automation and much of the shape is in
place:

- workflow triggers
- cron and idle scheduling
- the internal event bus

But lower-level direct event subscription paths still exist in the extension and
manifest layers. That means the repo-facing architecture still has more than one
real automation path even though the docs say workflows are the one public
surface.

## Desired Outcome

- `workflow` remains the one public automation surface.
- Hook-like reactions are expressed as event-triggered workflows.
- Heartbeat and standing-order behavior are expressed as standard workflow
  triggers or trigger helpers.
- The internal event bus stays internal; repo users interact with workflows.

## Constraints

- Do not add a second public hook engine beside workflows.
- Keep deterministic automation separate from agent judgment.
- Preserve the ability to express lightweight operator and maintenance work.

## Done When

- Hook-like and schedule-like automation are modeled as workflows.
- Public docs explain one automation surface, not several overlapping ones.
- Any repo-facing hook or heartbeat feature lands as a workflow extension, not
  as a parallel runtime concept.
- Direct extension/manifests event plumbing no longer acts as a parallel
  automation surface.

## References

- https://docs.anthropic.com/en/docs/claude-code/hooks-guide
- https://docs.openclaw.ai/automation/cron-vs-heartbeat
