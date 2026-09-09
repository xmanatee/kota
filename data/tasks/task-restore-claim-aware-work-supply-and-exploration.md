---
status: open
priority: p0
---
# Restore claim-aware work supply and exploration

## Problem

At main 763e14b14 on 2026-09-09, all four open tasks have retained
needs_attention run owners, but dispatcher calls all four actionable and emits
queue.available. No builder is executing or queued. Explorer consequently sees
neither an empty nor thin queue. All six dependency edges resolve to done tasks.
The retained SQLite history since August 26 has zero explorer runs. The watchlist
has 116 sources, 115 snapshots, and its newest lastSeen is July 8.

Evidence: .kota/runs/2026-09-09T16-26-07-038Z-dispatcher-39bhit/steps/assess-and-dispatch.json;
repo-tasks-domain.ts selectActionableRepoTasks/getRepoTaskQueueSnapshot;
autonomy/queue-policy.ts; dispatcher/inspection.ts; explorer/assessment.ts.
Task eligibility is file/dependency-based while runtime resource admission
correctly rejects an already owned task. The two projections disagree.

## Desired Outcome

Give queue consumers one authoritative available-work projection joining repo
task intent with existing runtime ownership. Distinguish unclaimed runnable work,
running work, retained recovery work, dependency waits, and external blocks.
Use it in dispatcher, explorer, parked-progress detection, and operator status.
Keep final claiming atomic in the existing runtime; this read model is not a
second scheduler, claim store, or persisted task lifecycle.

Replenish genuinely thin independent work using the existing explorer and
watchlist. A blocked unrelated dependency must not veto all exploration.
Use an explainable low-water decision relative to useful available work and
capacity, not total task files. Refresh relevant sources and propose only useful,
nonduplicative opportunities. No-action is valid; record what evidence or source
change warrants revisiting, so idle ticks do not repeatedly spend agent capacity.
Source rechecks may be time-due; time alone is not evidence for another AI review.

## Constraints

- Preserve retained claims/worktrees and owner pauses/backoff. Do not count them
  as spare work or release ownership to make the queue look healthy.
- Reuse explorer admission, last actual exploration state, typed events and
  runtime deduplication. Replace contradictory availability calculations.
- The archived claim-aware queue task describes a retired lifecycle; do not
  restore ready/doing directories, claim files, or a compatibility adapter.
- This task owns work supply, not semantic reviewer strategy or blocker repair.

## How We Will Know

One boundary-level proof covers a queue containing only retained owners, mixed
available/owned work, and an unrelated dependency wait. Atomic claiming still
prevents duplicate ownership. A live resumed dispatcher explains the current
four retained runs truthfully; when independent supply is thin, one explorer
consumes fresh source evidence, creates a justified opportunity or records an
honest no-action, and does not repeat that decision on unchanged inputs.
Record trigger provenance, task/claim counts and slot refill after completion;
passing a pure queue helper alone is not end-to-end delivery evidence.

## Implementation and verification

The isolated change set joins task intent with the existing runtime resource
projection for dispatcher, explorer, parked-progress detection, task list/status,
and the shared Tasks UI. Hosted scopes resolve the canonical daemon database and
live capacity. Retained owners are preserved, missing ownership evidence stays
unknown, and unrelated dependency waits do not veto independent exploration.
The reserve target is one capacity-sized batch of unclaimed runnable tasks.

Explorer rechecks watchlist sources through the registered read tool, saves the
observed content in run artifacts, and admits AI review only for changed source
or task evidence. Its existing post-integration publication records observations,
the last actual exploration, and the reviewed fingerprint, including no-action.
A stale publication cannot overwrite a newer observation.

The combined work-supply integration scenario passes through the production
workflow host: four retained owners, mixed independent work and dependency wait,
fresh source consumption, no-action publication, unchanged-input AI suppression,
and duplicate-claim rejection. The rendered Tasks probe shows available=0,
running=0, queued=0, retained=4 for an isolated four-owner fixture. These are
fixture observations, not live observations of the owner's retained runs.
Typechecks, scoped Biome checks, and generated binding freshness pass. The selected
owner run passed 139 of 140 tests; the failure pins schema version 5 while the
unchanged schema owner declares version 6. Broader checks also encountered
runtime dispatch failures, a missing run-metadata failure in the existing task
mutation host scenario, and an unrelated continuity-render expectation. One idle
dispatch failure was reproduced with the original runtime projection restored.
Run-local evidence and the detailed validation summary are retained under builder
run 2026-09-09T16-49-08-994Z-builder-q22o30.

## Live verification (2026-09-09 20:03 UTC)

The operator drained active work, restarted the supervised daemon onto
1461431af, and resumed normal dispatch. Dispatcher
2026-09-09T20-03-03-492Z-dispatcher-4c50ui reports ownershipAvailable=true,
available=0, retained=4, capacity=2 and no builder targets. It correctly admitted
explorer 2026-09-09T20-03-14-123Z-explorer-24y64f with the same four retained owners.
Explorer inspect-queue agreed; inspect-watchlist failed at 20:03:27.449Z:
response body exceeded max_length (20000 bytes); Content-Length was 92841 bytes.
The failed run has no sandbox or retained resources. Fresh source review,
unchanged-input suppression and builder refill remain unproven in production.

This is now actionable implementation work, not a missing owner permission.
refreshExplorerSources expects returned is_error results, but production
step-context.runTool throws for failed tools when deps.runTool is absent; injected
test runners can return those same errors. One failed external source therefore
rejects the whole source batch before its inaccessible observation is recorded.
Repair the owning tool-result/collection contract consistently, inspect other
callers before changing it, and retain bounded fetches and source-level failure
evidence. Do not catch all failures as no-action, bypass authority/cancellation,
raise limits without analysis, or weaken the web-access security boundary.
Use the existing scenarios to prove the real runner contract with mixed healthy,
oversized and inaccessible sources; preserve genuinely fatal runtime failures.
Then complete the original live acceptance. The capture below remains an
acceptance obligation, not a reason to defer this already reproduced repair.

## Source collection repair (2026-09-09)

The workflow tool runner now returns tool error results consistently for registered
and injected runners. Declarative tool steps and repair checks explicitly reject
those results; explorer records source-level failures and continues the bounded
batch. Runtime policy failures and cancellation still reject execution. Run and
step cancellation reaches the web transport, and cancelled results cannot become
source observations. Fetch limits and public-network policy are unchanged.
Source content and failure text are retained with the workflow run, with working
copies in the authorized agent directory so cleanup does not erase the evidence.

The combined production-host scenario now uses the registered web tool and real
HTTP transport policy with controlled DNS/network responses: a healthy source,
the reproduced 92,841-byte Content-Length failure, and HTTP 503. Its controlled
agent reads the observed files once, publishes a specific no-action revisit
condition, and is skipped after unchanged due rechecks. Evidence survives sandbox
cleanup. Missing tool registration rejects the run without publication. The same
scenario verifies retained-only and mixed work supply, unrelated dependency waits,
retained admission rejection, atomic contention for available work, and availability
after resource release. These remain fixture observations, not live acceptance.
Owner checks cover tool-step retry/failure, repair rejection, runtime authority,
step cancellation and web request cancellation. Two existing checks could not
complete in this sandbox: process registration requires denied /bin/ps, and the
web save-path symlink check encounters EPERM during cleanup. Run-specific evidence
and validation details are under builder 2026-09-09T20-06-43-616Z-builder-r6s0z1.

The reproduced implementation repair is complete. Live source review, unchanged-input
suppression, and slot refill remain unverified until runtime integration and an
operator-resumed run of this revision. A read of the cited live explorer step
artifact was denied; no live data or launching-daemon controls were changed.
The operator capture below remains the concrete prerequisite for completion.

## Live exploration finding (2026-09-09)

Explorer run `2026-09-09T22-54-43-618Z-explorer-wj7210`, at head
`e16275b484ea81cf015dc5192d5e0ab4e384eef2`, reached agent review with
ownershipAvailable=true, available=0, retained=4, running=0, queued=0 and
capacity=2. Its collection retained 116 source observations instead of aborting
on an individual fetch failure. This proves live collection and review admission,
but not useful source extraction, unchanged-input suppression or slot refill.

The retained `source-evidence/` files show 45 identical 186-character GitHub
preload fragments and 74 truncation notices overall. OpenClaw's
`0b5c4741d1c147be5fddf0c75c5c0f478ced75a3c3b71cf8751002122b8f3831.txt`
contains no repository content; ACP's
`ba1e486a66fea4a7674c1a99a3c6608b1356c003ae0a968d4a300937eacf219c.txt`
contains a title and incomplete layout script. These are source-access evidence,
not evidence of upstream product changes.

`web-access/web-fetch.ts` passes the default 20,000-character output budget to
`readResponseTextPrefixWithLimit` as raw response bytes before HTML extraction.
`explorer/source-evidence.ts` then accepts any nonempty successful result and
fingerprints it as source content. A page whose article follows a large head can
therefore publish boilerplate as reviewed evidence and hide later article changes.

Reopened this same task for the actionable collection-quality repair. Obtain
useful page content within explicit bounded transport and output budgets, and
distinguish unavailable source content from a successful substantive observation.
Preserve the last substantive content identity when only unusable markup is
available. Keep public-network, cancellation, byte-limit and injection boundaries;
do not solve this with unlimited reads, silent source substitutions, or a second
fetch pipeline. No upstream feature or benchmark task is justified by these bodies.

Prove the real web-tool/explorer boundary with representative HTML whose article
follows more than 20 KB of head markup: retain article evidence, observe a changed
article under unchanged head markup, and suppress repeat review of unchanged
content. Include unusable and oversized responses without losing failure evidence
or weakening bounds. Then finish the existing live acceptance below. The remaining
live observation obligation does not prevent this implementation repair.

## Outstanding live acceptance

After integration, retain attributable dispatcher/explorer evidence at
`.kota/operator-captures/claim-aware-work-supply-live.md` or an equivalent runtime
artifact, including useful source review, unchanged-input suppression, and slot
refill after completion.

The builder instructions explicitly prohibit controlling the launching daemon,
and this native permission profile denies its canonical SQLite files. Therefore
this run cannot supply the required live resumed-dispatcher observation or prove
live slot refill. Preserve retained owners, pauses, and backoff. Capture trigger
provenance, available/running/queued/retained counts, an explorer's justified
opportunity or specific no-action revisit condition, the subsequent unchanged
input decision, and slot refill after completion in the named operator artifact.
