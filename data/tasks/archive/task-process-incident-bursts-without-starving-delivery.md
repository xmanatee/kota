---
status: done
---

# Process incident bursts without flooding the queue or starving delivery

## Observed Failure

September 15's Telegram poll failures accumulated 95 pending health-reviewer
batches with 471 signals while dispatch was quota-paused. These are code-only
runs, not 95 AI reviews. Production reducer replay found all batches repeated the
same current issue revision and requested zero improver agents. Deduplication of
semantic decisions works, but admission still creates a separate durable run for
every batch flush: `src/core/workflow/workflow-queue.ts` makes batch flushes distinct
regardless of queue mode.

After resume, the backlog occupied both shared workflow slots, repeatedly updated
the same projection, and delayed fresh dispatcher admission. The control API also
took seconds to respond; the health endpoint recorded event-loop delays of 8-18
seconds. Establish the expensive synchronous owner with measurements rather than
assuming every delay comes from the reducer. At 20:57, newly published tasks were
still awaiting dispatcher inspection while historical reviews drained.
`runtime-dispatch.ts` calls `refill()` before checking `occupiedCapacity < capacity`
for idle inspection. A continuously nonempty metadata queue can therefore prevent
the dispatcher from even observing newly published tasks. Repair this through the
existing admission/inspection owner, without exceeding concurrency or introducing
a builder-only scheduling mechanism. A manual dispatcher request is recovery,
not proof that automatic replenishment works.

## Retained Evidence

Inspect canonical `.kota/kota.sqlite` read-only: `runs.workflow =
'autonomy-health-reviewer'`, `scope_id = '8nrg1m'`, and the parsed
`trigger_json.payload.groupingKey =
'scopeId=8nrg1m|dedupeKey=module:telegram:external-provider-failure'`.
Use September 15 admissions before 20:30 UTC. Each row retains exact run identity,
input events, occurrence timestamps and attributed evidence. Join to run artifacts
for reviews that executed. Incident identity is
`autonomy-issue-a0a5540ecf3ae944cbab`; its previous task
`task-generated-95a6992d795ad4d6` is done, not active repair ownership.

The coordinator may cancel only unstarted, sandbox-free redundant batches after
this evidence handoff. Cancellation does not resolve the incident or discard its
inputs. Consume needed cancelled records before the existing 30-day retention;
retain a compact necessary evidence artifact through the ordinary run owner.

## Outcome And Acceptance

- Coalesce pending observations through the existing batch/queue owner without
  losing attributed failure/recovery order, revision changes or independent
  incidents. Do not keep only the last batch or globally change all-batch semantics.
- Avoid repeating expensive projection/history scans for unchanged incident
  decisions. Use existing blocking-operation/artifact mechanisms where appropriate;
  do not add a second incident store, scheduler or arbitrary cooldown ladder.
- Preserve new actionable and critical transitions, existing improver deduplication,
  restart durability, and the configured shared concurrency limit.
- Verify a representative burst during pause and its subsequent drain: bounded
  queue/processing growth, responsive control API, no lost evidence, and actual
  dispatch of newly available work. Test the common behavior, not every workflow.
- Retire replaced paths and redundant proofs. Separate provider recovery from
  repair of this queue/processing defect; do not claim a network outage is fixed.

## Completion

Implemented opt-in pending-batch coalescing through the shared workflow queue,
capacity-independent admission of automatic idle inspection, and worker/artifact
health review preparation. Occurrence chronology and fresh-state finalization
remain authoritative; unchanged module evidence avoids repeated history scans.

The representative runtime journey retains all 475 observations in one paused
review, automatically dispatches newly published work, and stays within two shared
slots. Restart/redelivery, default batch behavior, semantic changes and module
recovery are covered by 104 selected tests. Static validation and the production
build passed; final-source compilation also passed in fresh scratch after a
repeat build hit sandbox restrictions deleting the earlier output. Run 2026-09-15T21-07-24-409Z-builder-yzw45h retains commands,
measurement provenance and limitations in artifacts/summary.md.

Canonical production state and socket/process-supervision access were restricted;
validation used real runtime/storage/workers with controlled external test ports.
The status projection remained observable during drain; live HTTP latency and
historical production queue cleanup were not measured or changed. Provider
recovery and deployment observation remain separate operational follow-up.

The critic's clear/reopen regression was repaired: generated task retirement now
requires the issue to remain resolved after the complete batch. The task-authority
component test preserves active repair work after reopening while confirming that
final clears still retire generated work. Health-owner, burst/recovery integration
and static checks passed after the repair.
