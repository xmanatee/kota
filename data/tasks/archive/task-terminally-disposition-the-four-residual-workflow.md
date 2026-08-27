---
status: dropped
---

# Terminally disposition the six current workflow dead letters

## Problem

The prior task counted four residual records and delegated two recovery-linked
records to a stale recovery task. Live state now contains six open records, and
the last trusted-host replay correctly refused to mutate anything because its
packet mapped `dlq-ee8ffaa1-ea74-4d68-816d-768c8101b0b7` to the wrong workflow
and a nonexistent source run.

The canonical source mappings are:

- `dlq-8c912d98-2b05-4160-a77f-5cec930102db`: progress-reviewer run
  `2026-08-14T12-00-00-500Z-progress-reviewer-s6z1hu`, invalid cross-scope
  evidence citation from the removed scheduled trigger.
- `dlq-fd469f02-35bf-4656-bfc6-a7bc7e3347fd`: progress-reviewer run
  `2026-08-15T01-12-05-786Z-progress-reviewer-scvrh5`, invalid local evidence
  citation from the removed completion batch.
- `dlq-69a4e56a-2119-4b30-b661-aa07517a4d83`: builder run
  `2026-08-13T14-51-09-064Z-builder-wv0950`, unreadable test-fixture `EACCES`.
- `dlq-f084687d-a51d-4ebd-aba7-574d9ac57ae6`: improver run
  `2026-08-13T10-24-20-075Z-improver-oku661`, unsupported
  `resumeSessionId`.
- `dlq-263574f1-cd0d-4369-a818-8050cae6d16e`: builder run
  `2026-08-13T10-23-52-462Z-builder-bojhem`, unsupported
  `resumeSessionId` for the currently preserved daemon-control lineage.
- `dlq-ee8ffaa1-ea74-4d68-816d-768c8101b0b7`: builder run
  `2026-08-13T10-23-52-461Z-builder-pmbg6e`, transient Codex 503.

The two older recovery-linked records `dlq-ae1303b0-...` and
`dlq-b8c26da0-...` are already `redriven`, not open, and must not be counted or
dismissed by this task.

## Desired Outcome

Use one daemon-owned DLQ decision and mutation path to inspect each exact
record, prove whether its work was recovered or its failure was superseded,
and redrive or dismiss it terminally. The accepted decision must be applied to
canonical state through the same API transaction; builder artifacts may carry
evidence but must not require a manually edited host replay packet or direct
filesystem mutation.

## Constraints

- Validate record id, workflow, source run, failure class, current status, and
  related task, resource, sandbox, and integration state immediately before
  mutation. A mismatch fails closed and remains visible.
- Do not redrive obsolete progress-review triggers, a transient provider
  failure whose source task already succeeded, or an old unsupported resume
  request after its work was recovered through a newer lineage.
- Do not dismiss `dlq-263574f1-...` until the daemon-control implementation is
  integrated or explicitly superseded without loss in canonical run state.
- Reuse the canonical DLQ client/action and recovery projection. Do not add a
  second ledger, one-off six-id scrubber, migration, or compatibility path.
- Keep every decision and source guard durable and operator-visible.

## Done When

- One artifact maps all six exact ids to verified source metadata, related
  task/run evidence, superseding evidence, and a redrive-or-dismiss decision.
- The canonical daemon applies all accepted decisions atomically per record and
  records terminal rationale without direct file writes or a hand-corrected
  packet.
- `workflow dlq list --json` reports none of the six ids as open, while the two
  already redriven records retain their history.
- A negative fixture reproduces the prior wrong source-run mapping and proves
  that no record is mutated.
- Run-state, DLQ, and task projections agree after restart.

## Source / Intent

Corrected from progress-review run
`2026-08-13T15-35-39-434Z-progress-reviewer-zckkp0` using the canonical DLQ
projection on 2026-08-16. This preserves the failed replay as evidence of a
useful guard and removes its stale counts and manual-host dependency.

## Initiative

Canonical workflow failure disposition.

## Acceptance Evidence

- Before/after canonical DLQ projections and the six-record decision artifact.
- Focused source-guard, terminal mutation, restart, and recovery-projection
  fixtures through the production daemon client.
