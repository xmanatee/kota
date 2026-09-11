---
status: open
priority: p0
---
# Make recovery evidence collection proportional to relevant work

## Problem

The September 10 live restart exposed a delivery bottleneck introduced by
`329fc7cab`. Builder `2026-09-10T02-03-16-222Z-builder-91e2py` entered
`inspect-target-task` at 15:52:17Z and was still there at 15:57:40Z, with no
agent started. The API remained responsive and fresh short-lived Node children
continued reading evidence. This is expensive preflight, not agent inactivity.
The activation drain waited for this run while further admission was closed.

`builderRecoveryRevision` invokes `collectBlockedEvidence` on `.kota/runs`,
including alternate eval evidence, before applying task relevance. A read-only
inventory found 3,452 run directories and 35,607 JSON files within the collector's
depth and file-size bounds, before its per-cohort cap. `readConfinedEvidenceJson`
spawns a new Node process per file. The new evidence reader also duplicates
directory anchoring already owned by `core/util/filesystem/anchored-files.ts`.
The direct blocking-operation call in builder recovery does not forward the
calling step's abort signal or progress reporter.

The completed preflight measured 1,048,479 ms host-active. After activation,
`qj0mm4` and `720nnv` each spent another approximately 1,082,000 ms host-active
in the same step. The first was already non-actionable because its committed
task contract had changed, but still performed the full export before skipping
the build. The current `un8vlq` scan also crossed host sleep; exclude the
September 10 18:21-18:51Z suspension from its elapsed-work diagnosis.

## Desired Outcome

Normal dispatch and retained recovery inspect attributable evidence without
repeatedly exporting the entire historical tree or spawning a process per leaf.
Keep one filesystem-safety boundary and one runtime-owned execution lifecycle.

## Scope

- Inspect builder preflight/recovery, blocked-promoter collection/review, and
  issue-evidence export together. Use existing scoped run/evidence ownership and
  explicit task/run/export references to select candidates before materializing
  content. Preserve discovery of attributable capability and eval outcomes.
- Reuse the shared anchored filesystem reader, extending a coherent batch read
  only if necessary. Remove the duplicate evidence-reader helper when migrated.
  Preserve no-follow, single-link, identity, size, redaction, scope and provenance
  checks; faster unchecked pathname reads are not a correction.
- Collect shared input once per assessment where appropriate. Do not add another
  persistent index, cache, queue, polling loop or arbitrary historical cutoff to
  conceal the repeated scan. Unavailable evidence stays explicitly unavailable.
- Route blocking work through its existing lifecycle so cancellation and useful
  collection progress propagate. Do not manufacture heartbeat progress or clear
  a safety pause to hide a slow operation.
- Keep the task intent and evidence assessment coherent across asynchronous
  collection. Recovery for `qj0mm4` captured its old task digest before commit
  `76bf6d037`, finished collection after that commit, and queued the stale
  digest. Its next preflight and publication invariant correctly rejected it.
  Recheck changed source intent through the existing admission/recovery owner;
  do not rewrite an active contract or loosen the publication guard. A known
  non-actionable target must not pay for an unrelated full-history scan.

## Acceptance

- With a representative large history, a new builder reaches agent preflight
  promptly; adding unrelated historical runs does not multiply expensive leaf
  reads, exports, or subprocess launches for that task. Record measured counts
  and elapsed time, not just a tiny-fixture pass.
- Relevant changed outcomes still authorize same-lineage recovery. Unchanged
  failures, timestamps, copied reports and the writer's own output do not.
- Existing evidence security and semantic tests remain valid at their owning
  layers; extend focused behavior cases rather than duplicating low-level tests
  in every workflow. Cancellation leaves no continuing evidence worker.
- Observe real dispatch, activation drain completion and capacity refill after
  integration. Preserve held writers and their task/resource ownership.

This corrects an internal implementation defect. It needs no new owner permission
or manual capture. Existing recovery and activation tasks retain their separate
live acceptance requirements; this task does not claim them completed.
