---
id: task-backfill-progress-reviewer-windows-from-durable-ev
title: Backfill progress-reviewer windows from durable event journal cursors
status: ready
priority: p2
area: autonomy
task_class: Platform
summary: Teach progress-reviewer to select durable event-journal windows for run-count, task-count, and message-batch reviews so review evidence survives batch-buffer truncation and daemon restarts.
created_at: 2026-06-22T06:48:06.140Z
updated_at: 2026-06-22T06:48:06.140Z
---

## Problem

KOTA now has a durable `EventJournal`, journal replay support in workflow-ops
simulation, and progress-reviewer batch triggers for completed runs and builder
commits. The progress-reviewer evidence collector still treats the workflow
trigger payload as the event source: `collectProgressReviewEvidence` computes a
wall-clock window, while `listBatchEvents` reads only `batch.inputEvents`.

That is enough for normal small batches, but it leaves a review-quality gap
that the architecture doc still calls out: review consumers need
journal-backed windows where live buffers are insufficient, and message-count
reviews still need durable event-window selection. If a batch overflows,
truncates, or needs to be reconstructed after daemon restart, the review
artifact can record `droppedInputCount` without reconstructing the missing
event context from the journal. The reviewer then sees an incomplete causal
window even though the durable journal already has the input events.

## Desired Outcome

Progress-reviewer can select a bounded durable event-journal window for
`run-count`, `task-count`, and future `message-batch` reviews. The batch trigger
payload remains the fast path and correlation hint, but the evidence packet
backfills from the existing event journal when the journal is available and the
batch summary shows dropped/truncated input, a cursor, or a replayable source
event range.

The resulting `progress-review.json` should make the source of the review
window explicit:

- the normal `window` still bounds the review by time;
- the `batch` summary records the live batch count and dropped input count;
- journal-derived event evidence carries stable journal ids and redacted
  client-safe payload summaries;
- scope filtering keeps global reviews from mixing events without `scopeId` or
  compatible `projectId`;
- excluded evidence explains missing journal, expired entries, unknown scope,
  malformed payloads, or limit truncation.

## Constraints

- Reuse `EventJournal`, workflow runtime trigger state, and existing
  workflow-ops simulation/journal selector code where appropriate. Do not add a
  second event store, review ledger, or progress-review-specific journal.
- Keep the reviewer packet bounded by the existing progress-review limits.
  Journal backfill must not scan unlimited history or pass raw event payloads
  into the agent.
- Use the journal's redacted projection or an equally strict projection for
  agent-visible event summaries. Do not expose secrets, approval inputs,
  owner-answer payloads, raw tool results, or private run internals.
- Preserve existing manual and schedule review behavior. This task adds
  durable window selection for event-backed review kinds; it should not change
  the reviewer agent role, write scope, or action model.
- Keep exact event names and payload parsing in typed source/tests, not in a
  durable docs catalog.

## Done When

- `ProgressReviewEventEvidence` can represent journal-backed event refs with
  stable journal ids while preserving the existing compact event evidence shape
  for non-journal batch inputs.
- `collectProgressReviewEvidence` can read from the durable event journal for
  `workflow.completed`, `workflow.build.committed`, and
  `inbound.signal.received` review batches when the journal is available.
- Backfilled events are scope-filtered, redacted, bounded, and included in the
  evidence refs that the reviewer is allowed to cite.
- The progress-review artifact records enough window metadata to distinguish
  live batch inputs from journal-backfilled events and to explain dropped or
  unavailable journal evidence.
- Existing progress-reviewer tests still pass, including large packet
  compaction and hidden-id validation.
- Focused regression coverage proves a review with dropped batch inputs can
  recover the missing event context from a seeded journal, and a missing or
  expired journal produces an explicit exclusion instead of a silent pass.

## Source / Intent

Explorer run `2026-06-22T06-26-55-403Z-explorer-qxdbub` found a
strategic-ready coverage gap: the queue had only one actionable p3 maintenance
task, no backlog, and four strategic blocked alternatives that all still
required operator-captured evidence.

Local evidence:

- `docs/ARCHITECTURE.md` says progress-review consumers still need to choose
  journal-backed windows where live buffers are insufficient, and that
  message-count review still needs durable event windows.
- `src/modules/autonomy/workflows/progress-reviewer/workflow.ts` batches
  `workflow.completed` and `workflow.build.committed` events with bounded
  buffers and dropped-input accounting.
- `src/modules/autonomy/workflows/progress-reviewer/progress-review/collect.ts`
  builds the evidence window from wall-clock time and trigger payloads.
- `src/modules/autonomy/workflows/progress-reviewer/progress-review/event-evidence.ts`
  reads current batch `inputEvents`, not durable journal entries.
- `src/modules/workflow-ops/simulation/` already replays durable journal
  selectors and ships a progress-review journal replay fixture, so the
  nonduplicative gap is consuming journal windows in progress-reviewer evidence
  selection, not inventing a new replay primitive.

Blocked strategic alternatives considered but not chosen:

- `task-add-a-scientific-claim-reproduction-fixture-to-the` remains blocked on
  an operator-captured live eval pass.
- `task-add-an-unfamiliar-language-strategy-construction-f` remains blocked on
  an operator-captured live eval pass with active nested Codex auth.
- `task-add-cross-preset-runtime-parity-gate` remains blocked on operator
  transcripts from a host with all required harness auth configured.
- `task-capture-an-end-to-end-coding-task-parity-artifact-` remains blocked on
  all-harness operator capture under `.kota/runs/harness-parity-*`.

## Initiative

Outcome-aware autonomy progress review: reviewer decisions should be based on
complete, durable, scope-correct evidence windows rather than only the live
batch payload that happened to survive dispatch.

## Acceptance Evidence

- Focused test transcript for progress-reviewer evidence collection showing a
  seeded durable journal backfills dropped `workflow.completed`,
  `workflow.build.committed`, and `inbound.signal.received` batch context.
- Focused test transcript for missing/expired journal entries showing explicit
  `excluded` reasons in the evidence packet.
- A generated `progress-review.json` fixture or run artifact under
  `.kota/runs/<run-id>/` showing journal-backed event evidence with stable ids,
  redacted summaries, scope filtering, batch summary, and excluded evidence.
- `pnpm test src/modules/autonomy/workflows/progress-reviewer/workflow.test.ts`
  and the focused workflow-ops simulation journal replay tests pass.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm run validate-tasks` pass.
