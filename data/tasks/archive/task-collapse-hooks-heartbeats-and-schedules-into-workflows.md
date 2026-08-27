---
status: done
---

# Collapse hooks, heartbeat work, and schedules into the workflow surface

## Problem

KOTA already has the ingredients for automation and much of the shape is in
place:

- workflow triggers
- cron and idle scheduling
- the internal event bus

But lower-level direct event subscription paths still exist in the module and
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
- Any repo-facing hook or heartbeat feature lands as a workflow module, not
  as a parallel runtime concept.
- Direct module/manifests event plumbing no longer acts as a parallel
  automation surface.

## References

- https://docs.anthropic.com/en/docs/claude-code/hooks-guide
- https://docs.openclaw.ai/automation/cron-vs-heartbeat
