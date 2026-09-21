---
status: open
priority: p1
---
# Reject malformed workflow cron expressions through one bounded decoder

## Problem

Cron validation executes unchecked field expansion before establishing valid syntax, positive safe steps and bounded endpoints. A zero step hangs synchronous public definition validation; out-of-range and partially parsed fields can pass validation and produce absent or unintended schedules. Runtime load and reload invoke this validator synchronously, so blocking those paths is a supported risk, not an observed production outage.

Investigation: The changed-source review found a pre-existing defect at the cron validation boundary. An isolated public validateWorkflowDefinitions invocation with '*/0 * * * *' exceeded its three-second deadline; parseCronField increments by zero indefinitely. The same validator accepted '60 * * * *', after which the real ScheduleTriggerManager registered no timer, and accepted malformed '1/2/3' and '1,,2' fields as executable schedules. Both inspected DST regression inputs returned the expected future occurrences. The recent DST task repaired valid recurrence; these malformed-input failures justify a distinct follow-up linked to that work. Active-task and inbox searches found no overlapping outcome. Consolidating bounded field decoding at the existing cron owner should remove unchecked expansion and duplicated field assembly; that benefit remains unverified. No scanner observations were reassessed and no causal delivery-issue correlation was established. No live daemon, full test portfolio or static gate was exercised.

Evidence:
- git:3b41a4da3e8f4a6e1f1f4f21e9d4cad4f5aa0e36
- docs/STANDARDS.md
- docs/ARCHITECTURE.md
- docs/VERIFICATION.md
- src/core/workflow/AGENTS.md
- src/core/workflow/cron.ts
- src/core/workflow/cron.test.ts
- src/core/workflow/validation.ts
- src/core/workflow/validation-trigger.ts
- src/core/workflow/validation.test.ts
- src/core/workflow/runtime-dispatch-definitions.ts
- src/core/workflow/runtime-definitions.ts
- src/core/workflow/schedule-triggers.ts
- src/core/workflow/schedule-triggers.test.ts
- data/tasks/archive/task-preserve-cron-progress-across-dst-transitions.md
- data/tasks/archive/task-reject-misinterpreted-reminder-schedules.md
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t10-10-18-675z-archite-8c82f542538333d904c4ff011cd3e5816a123621b467f2a04a3599474694b500/agent/cron-admission-probe.mjs
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t10-10-18-675z-archite-8c82f542538333d904c4ff011cd3e5816a123621b467f2a04a3599474694b500/agent/cron-admission-transcript.json
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-21t10-10-18-675z-archite-8c82f542538333d904c4ff011cd3e5816a123621b467f2a04a3599474694b500/agent/cron-admission-review.md

## Desired Outcome

Malformed cron definitions fail promptly with actionable source and field diagnostics. Validation and next-occurrence calculation share one bounded interpretation of the supported grammar, while valid scheduled workflows retain their recurrence behavior.

This is an unverified expectation, not a measured improvement.

Maintained consumers:
- Workflow authors submitting definitions through registerWorkflowDefinition and validateWorkflowDefinitions
- Runtime definition loading, readiness inspection and reload
- ScheduleTriggerManager setup, reconciliation and timer re-arming

Alternatives considered:
- Leave the implementation unchanged: retains the reproduced validation hang and misleading schedule acceptance.
- Delete cron parsing: removes maintained workflow scheduling capability.
- Use one strict bounded decoder within the existing cron owner: preferred because both maintained parsing consumers already belong there.
- Adopt a parser dependency only if it preserves KOTA's supported syntax, AND day filters and Sunday aliases without introducing another scheduling engine.

Migration and retirement: Replace unchecked field expansion with complete grammar and numeric validation before bounded enumeration. Route validateCronExpr and getNextCronTime through the same decoded representation, retiring their duplicate expression assembly. Keep definition-specific diagnostics at validateTrigger and preserve the repaired transition search. Link the generated task to task-preserve-cron-progress-across-dst-transitions as distinct follow-up provenance. Keep reminder parsing and timer ownership unchanged.

Common behavior: Decode the complete five-field cron expression into bounded valid field values.
Stable variation point: Definition validation presents contextual diagnostics; occurrence calculation consumes decoded values and applies timezone recurrence.
Canonical owner: src/core/workflow/cron.ts

## Constraints

Preserve the maintained consumers' domain-specific behavior.

## How We Will Know

Exercise malformed inputs through public workflow validation with an external process deadline, including zero/negative steps, out-of-range endpoints, incomplete syntax and unsafe numeric values. Confirm rejection occurs before schedule registration. Retain valid wildcard, list, range and step behavior, Sunday aliases, AND day filters, UTC defaults, bounded no-match behavior and DST transition cases. Use the real ScheduleTriggerManager to observe valid setup, re-arming and reload with unrelated work. Run check:fast and proportionate affected workflow tests; retain a consumer transcript without requiring a live daemon or model.

Show that validation and recurrence consume one field-validity authority, unchecked expansion and duplicated field assembly are retired, and callers remain straightforward. Keep distinct decoder rejection and scheduler lifecycle proofs without adding a parallel parser, scheduler or redundant test catalog.

Record actual migrated callers, retired paths and the simpler result in this task's completion evidence. The gardener follows this task; expected benefits alone do not establish success.
