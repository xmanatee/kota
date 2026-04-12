---
id: task-scheduler-event-triggers
title: Implement event-triggered automations in the scheduler module
status: done
priority: p2
area: modules
summary: The scheduler module describes event-triggered automations but only implements time-based reminders. Event-based triggers are missing.
created_at: 2026-04-11T21:40:00Z
updated_at: 2026-04-12T02:59:26.837Z
---

## Problem

The scheduler module at `src/modules/scheduler/index.ts` registers a
`schedule` tool that supports time-based reminders (one-shot and repeating).
The module's description mentions event-triggered automations, but the
implementation only handles cron/time triggers. There is no way for an
operator or agent to say "when event X fires, do Y" through the scheduler.
This limits the scheduler to alarms rather than reactive automation.

## Desired Outcome

The scheduler's `schedule` tool gains an event-trigger variant: an operator or
agent can register a rule like "when `workflow.completed` fires with
`workflow === 'builder'`, send a summary to Slack." The scheduler subscribes
to the specified bus event and executes the action when the predicate matches.
Rules are persisted so they survive daemon restarts.

## Constraints

- Extend the existing `schedule` tool schema rather than adding a new tool.
- Predicates should be simple JSON-match expressions, not arbitrary code
  execution.
- Actions should be limited to emitting a bus event or invoking an existing
  tool, not running arbitrary code.
- Persisted rules must be stored through the module's own state, not by
  patching core stores.
- Keep the implementation small. This is a building block, not a full rules
  engine.

## Done When

- The `schedule` tool accepts event-trigger definitions with a bus event name,
  optional match predicate, and action.
- Registered event triggers fire correctly when matching events are emitted.
- Triggers survive daemon restart via persistence.
- Unit tests cover creation, matching, non-matching, and persistence.
- The scheduler skill prompt is updated to describe the new capability.
