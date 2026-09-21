---
status: open
priority: p2
---
# Keep distant workflow schedules dormant without timer overflow churn

## Problem

ScheduleTriggerManager passes the full remaining deadline to native setTimeout. Valid schedules beyond its representable delay produce repeated 1 ms wakeups and overflow warnings. The early-wakeup guard preserves the deadline but re-arms the same invalid delay. Setup, reload and recurrence share this affected owner.

Investigation: Changed-source investigation found a pre-existing timer-boundary defect: publicly validated monthly, annual and 30-day schedules repeatedly pass oversized delays to native setTimeout. An isolated production-owner probe observed 47–49 timer creations during each 60 ms observation window, versus one for the daily control. Node emitted overflow warnings and substituted 1 ms. The deadline guard prevented early enqueue but repeatedly re-armed the oversized delay. Recent reload work consolidates setup and reconciliation appropriately; this distinct follow-up preserves that delivery. Active-task and related archive searches found no overlapping repair. No scanner observations were reassessed or delivery-issue correlation established. No live daemon, static gate or test suite was run; original builder artifacts were inaccessible.

Evidence:
- git:3527d10ebe015bc8a9885cf6152fb0d7b39af881
- docs/STANDARDS.md
- docs/ARCHITECTURE.md
- docs/VERIFICATION.md
- src/core/workflow/schedule-triggers.ts
- src/core/workflow/schedule-triggers.test.ts
- src/core/workflow/cron.ts
- src/core/workflow/validation-trigger.ts
- src/core/workflow/runtime-context.ts
- src/core/workflow/runtime-definitions.ts
- src/core/workflow/runtime-dispatch.ts
- src/core/workflow/run-coordinator.ts
- data/tasks/archive/task-apply-schedule-edits-on-workflow-reload.md
- data/tasks/archive/task-preserve-cron-progress-across-dst-transitions.md
- data/tasks/archive/task-generated-0fe92c81581728bc.md
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t11-19-58-817z-archite-f1fdf4bfe9c0f545ada12566af68d741d53456bbce8fca7ecc5e7d257d36e7e0/agent/long-schedule-probe.mjs
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t11-19-58-817z-archite-f1fdf4bfe9c0f545ada12566af68d741d53456bbce8fca7ecc5e7d257d36e7e0/agent/long-schedule-probe.json
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t11-19-58-817z-archite-f1fdf4bfe9c0f545ada12566af68d741d53456bbce8fca7ecc5e7d257d36e7e0/agent/schedule-review.md

## Desired Outcome

Valid distant cron and interval schedules retain their actual next-run time while waiting through bounded native timers, without overflow warnings, rapid re-arming or early dispatch. This expected benefit remains unverified until implemented.

This is an unverified expectation, not a measured improvement.

Maintained consumers:
- Workflow runtime startup and schedule reconstruction
- Workflow definition reload and next-run projections
- Cron and interval recurrence feeding the production workflow queue

Alternatives considered:
- Leave unchanged: retains reproduced timer and warning churn.
- Reject distant schedules: removes valid monthly, annual and long-interval capability.
- Bound native waits locally while retaining the actual deadline: preferred; RunCoordinator already uses a comparable bounded-wait pattern.
- Extract a universal timer service or introduce polling: additional ownership is unsupported by this investigation.

Migration and retirement: Repair native-delay handling in the existing ScheduleTriggerManager scheduling path, retiring direct oversized waits across setup, reconciliation and re-arming. Preserve actual deadlines, callback identity guards and current-definition refresh. Link task-apply-schedule-edits-on-workflow-reload, task-preserve-cron-progress-across-dst-transitions and task-generated-0fe92c81581728bc as related provenance; their completed outcomes address different boundaries. Keep unrelated timer owners unchanged.

## Constraints

Preserve the maintained consumers' domain-specific behavior.

## How We Will Know

Reproduce accepted distant cron and interval inputs with native Node timers and verify absence of overflow churn and early enqueue. Use controlled time to establish bounded intermediate wakes, unchanged next-run projections, eventual single delivery and recurrence. Exercise reload to and from distant deadlines, payload refresh, cancellation and unchanged progress. Retain existing DST, dispatch-window and scope behavior checks, plus an isolated public-runtime reload transcript with inert actions. Run check:fast and proportionate workflow tests.

Show that one existing schedule-owner path handles native delay bounds for all maintained scheduling callers, with no parallel scheduler, new configuration or duplicated timing authority. Re-run the retained probe and report observed timer behavior; preserve distinct recurrence and reload proofs without duplicating their catalogs.

Record actual migrated callers, retired paths and the simpler result in this task's completion evidence. The gardener follows this task; expected benefits alone do not establish success.
