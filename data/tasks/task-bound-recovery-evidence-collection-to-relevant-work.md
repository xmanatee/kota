---
status: blocked
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

The September 11 restart reproduced the same cost in concurrent preflights.
Completed workflows also triggered overlapping reconciliation requests while
`hjhox7` awaited recovery: its resolver had no in-flight exclusion, so each
request could launch another full scan before one reconciled the run. The
common queue manager now shares concurrent retained-run assessments; keep that
ownership and do not add a builder-specific lock. This prevents amplification,
but does not make the remaining full-history scan proportional to task evidence.
Recovery reconciled `hjhox7` to its revised task and retained worktree, but both
builders were still collecting evidence at 03:50Z. During host-active inspection,
the control API repeatedly exceeded 5-, 10- and 20-second request deadlines;
fresh confined-reader child processes continued and a main-thread sample spent
its timer callback in repeated SQLite preparation/row mapping. Check both
evidence collection and its shared authority reads for history-proportional work
on the control thread; this sample does not establish which caller owns that cost.
Verify control-API responsiveness under concurrent representative histories,
not only aggregate collection duration. Exclude only independently verified host
suspensions. `core/workflow/active-timeout.ts` currently treats every timer gap
over its threshold as host suspension: the 03:27Z dispatcher reported 146616ms
suspended without a matching macOS sleep/wake event. Distinguish host suspension
from event-loop starvation through the shared timing owner, so blocked timers
cannot hide scan cost or defeat active-runtime deadlines. Preserve real sleep
protection; do not replace it with blind wall-clock timeouts or a per-workflow
sleep detector.

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

- Evidence-backed investigators must actually receive the selected scoped
  content, not just paths that their sandbox cannot read. September 11 improver
  runs `2026-09-11T15-53-01-802Z-improver-o70z6z` and
  `2026-09-11T16-53-01-112Z-improver-zeg6xk` both returned `observe` because
  issue summaries were empty and referenced Telegram logs / control-monitor
  artifacts were absent in the checkout and denied in canonical state. Their
  `steps/apply-disposition.json` records this explicitly. Reuse the existing
  scoped export owner for these maintained consumers; do not grant raw host
  reads, copy all history, or treat an inaccessible reference as sufficient
  investigation evidence. Prove a scoped incident reaches its investigator with
  attributable relevant content and that unrelated/secret state remains denied.
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


## Implementation and verification — September 11

Run `2026-09-11T04-24-49-479Z-builder-ddrk4y` implements scoped run selection
before materialization, shared anchored batch reads, asynchronous issue export,
abort/progress propagation, and canonical task rechecks after collection.
Known stale targets skip collection. Control summaries use storage-level
aggregation and lightweight run-state projections instead of repeatedly loading
historical triggers, attempts, resources and processes. Active deadlines require
independent OS suspension evidence; timer starvation stays chargeable runtime.
The duplicate evidence-reader boundary is removed. Retained-run exclusion,
resource ownership and publication guards remain with their existing owners.

The production daemon/control-route journey seeded 3,452 unrelated durable runs
and 37,972 JSON leaves. Selected collection stayed at 70 reads and two helper
launches: 133 ms without history and 198 ms with history. Three concurrent
preflights reached the next step in 1.32, 2.23 and 3.12 seconds; the slowest of
14 status-plus-health request pairs took 162 ms. Only network listener/probe
ports were controlled; scoped authority, dispatch, workers, evidence reads and
control routing used production owners. No host suspension was subtracted.
A separate real 6,500 ms event-loop stall expired its active deadline with
6,500 ms active and zero suspended time.

`pnpm check:fast` passed. The build wrapper cannot remove sandbox-protected
`dist` directories; production compilation is checked in a fresh run-owned
output directory. Focused filesystem/evidence,
blocking worker, deadline and builder tests passed, including changed outcomes,
copied reports, own-writer exclusion and source drift during collection.
Broader queue/coordinator, lifecycle finalization/restart, publication and daemon
activation tests passed. The lifecycle test's runtime-created allocator now
controls the same external listener probe as its direct lifecycle fixture;
this resolves its sandbox-specific setup failures without replacing lifecycle
semantics. Evidence and command logs remain in this run's agent directory,
including `control-history-final.log`, `starvation-probe.json`,
`owner-final.log`, `recovery-broad-final.log`, `lifecycle-final.log`,
`revision-final.log`, `check-fast-final.log` and `build-final.log`.

The critic repair restores discovery of task-named eval exports even when the
body has no export citation; content attribution still controls relevance.
Retained assessments now receive a required coordinator-owned abort signal.
Run/scope cancellation and shutdown stop their real evidence workers, and idle
waits retain ownership until assessments settle without using execution capacity.
The queue continues sharing concurrent assessments and preserving stale-result
rejection. The repair runtime suite passed 61 tests, including all three retained
cancellation journeys, restart/activation, queue restoration and worker lifecycle.
The representative-history rerun held at 70 reads/two helpers; concurrent
preflights reached the next step within 1.41 seconds and control-request pairs
within 23 ms (`repair-runtime.log`). Task-named export discovery and content
attribution passed at the evidence owner (`repair-behavior.log`).

## Blocked on

kind: operator-capture
path: .kota/runs
description: Automatically collected, task-attributable runtime evidence after this changeset publishes and activates, showing real dispatch, drain completion, capacity refill and preserved held-writer ownership; equivalent scoped exports are accepted.

The implementation and independent safety checks are complete. The remaining
acceptance is observation of this revision on the launching daemon after
runtime-owned publication and activation. Publication follows this agent step;
this step cannot observe its own future integration, and its workflow rails
prohibit controlling the launching daemon. The test daemon above proves the
production composition under representative history, not deployment of this
changeset. No new permission, manual capture, credential change or safety-pause
change is requested. Resume once the runtime's existing activation/recovery
owners expose attributable post-integration evidence. Preserve the original
held writers and their task/resource lineage. The separate activation and
recovery tasks retain their own live acceptance contracts.

<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=2026-09-11T10:24:11.823Z -->
