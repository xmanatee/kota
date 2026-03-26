---
id: task-collapse-hooks-heartbeats-and-schedules-into-workflows
title: Collapse hooks, heartbeat work, and schedules into the workflow surface
status: backlog
priority: p1
area: workflow
summary: KOTA already has event triggers, cron triggers, idle triggers, and an internal event bus. Keep workflows as the single automation surface and express hook-like reactions, standing orders, and heartbeat jobs as workflow triggers instead of adding another public automation model.
created_at: 2026-03-26
updated_at: 2026-03-26
---

## Problem

KOTA already has the ingredients for automation:

- workflow triggers
- cron and idle scheduling
- the internal event bus

There is pressure to add repo-facing hooks and heartbeat-style automation, but
doing that as a separate engine would duplicate workflows and reintroduce the
same conceptual sprawl.

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

## References

- https://docs.anthropic.com/en/docs/claude-code/hooks-guide
- https://docs.openclaw.ai/automation/cron-vs-heartbeat
