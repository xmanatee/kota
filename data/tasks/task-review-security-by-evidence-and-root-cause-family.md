---
status: open
priority: p1
---
# Review security by evidence and root-cause family

## Current Contract

Reopened for resource-safe publication/replay validation through available scoped
evidence and the supported isolated runtime. Preserve full finding lineage,
unchecked coverage, independent variants and rejection of unsafe task mutation.
The September 12 owner waiver makes the later live yield/occupancy comparison
non-gating follow-up; no savings or improved security are inferred from counts.
The old database builder has released its claim, but today's retained security
scan/finalization run is owned separately. Leave its contract and live outbox
recovery to that owner; do not duplicate its repair or manufacture canonical proof.

This contract supersedes historical blocking and operational-capture requirements.


## Problem

The owner observes repeated security-task production around related authority
boundaries. Do not assume those findings are false or equivalent. At 763e14b14,
recent fixes and open findings include credential access, database confinement,
post-run Git execution and browser persistence. They need explicit coverage and
root-cause ownership, not either blanket suppression or one isolated patch per sink.

Inspect security-review admission, due-check, candidate generation, critic,
task publication and deduplication together with actual recent transcripts and
fix diffs. Separate counts of cheap code runs from agent occupancy and distinguish
confirmed exploit preconditions from speculative claims. Record the pinned cohort,
root families, task outcomes, repeat findings and useful review yield.

The September 3-9 artifact-backed cohort has 28 reviews: 25 successes and three
provider/CLI failures; 14 confirmed findings, zero task updates, and 12 no-finding
reviews. Investigation/revalidation steps total 87.1 elapsed minutes, not model
compute or a concurrency-adjusted capacity share. Six findings are native-authority
variants. Writer database protection landed in c604ec75c, then non-writer exposure
was found: native-run-authorization.ts returns before constructing denials when
writer identity is absent. Four associated fixes needed substantive critic repair.
Exact repeated finding identity was NOT demonstrated; all 14 identities differ.
security-review-tasks.ts publishes each finding separately; task-identity matching
requires finding ID plus candidate ID, whose file/line component is unstable.

## Desired Outcome

Make meaningful unreviewed security changes and findings, not elapsed time or a
mandatory after-build ritual, admit semantic review. Coalesce related changed
surfaces into a bounded review with honest coverage. Review all justified findings
in that scope; there is no quota requiring exactly one issue or task per run.
Group findings only when a common authority owner and repair really resolve them;
retain distinct exploit preconditions and regressions even inside one repair task.
Update an existing active family task instead of generating sibling sink tasks.
Reopen a resolved issue only for new evidence; a broader family must not suppress
a distinct serious finding. Critical new evidence may bypass batching delay.
Match production owner plus violated invariant, retaining variants and evidence;
do not mutate an active builder's admitted contract underneath it. Use existing
resource-aware task publication/reconciliation and preserve completed evidence.

Use deterministic security signals where they fit, after checking existing owners:
dependency advisories, unsafe call sites and known policy bypass patterns can be
screened by an established local analyzer. Scope-aware static/taint analysis can
inform the agent; it cannot prove all authorization, race or sandbox properties.
Sandboxing contains execution, it does not automatically discover vulnerabilities.
Compare a small local scanner experiment against known repaired and clean cases;
adopt only useful rules, otherwise retain a documented no-adoption decision.

## Constraints

Reuse current security review, typed findings, task materialization and durable
admission state. No second vulnerability database, custom general scanner or new
security bot. No uploading source, secrets or transcripts to external scanners.
Keep unreviewed evidence when a run fails; a no-finding result must state coverage,
not silently mark unchecked files reviewed. Do not suppress by filename alone,
equate scanner silence with safety, or remove tests that catch distinct exploits.

## How We Will Know

A pinned recent review/fix cohort shows real family coverage and unnecessary
repeats separately. One common-root multi-sink example produces a coherent task,
unchanged evidence produces no duplicate, and a distinct new exploit still admits.
Public trigger/publication evidence proves changed-head freshness and retry after
failed review. Compare agent time and actionable outcomes before/after without
tuning solely to make a count look better.

## Research Basis

https://semgrep.dev/docs/category/local-and-cli-scans and
https://semgrep.dev/docs/semgrep-ci/sample-ci-configs describe established local
and baseline-aware scanning. Findings are inputs to investigation, not proof that
all related code is safe or that an ignored finding was fixed.

## Retained implementation and evidence

Run `2026-09-09T16-49-10-933Z-builder-8sf2yv` implements per-path Git-content
coverage in revisioned runtime state, execution-head refresh, explicit critical
new-evidence requests, common-owner/invariant family identity, evidence replay
suppression, preserved variant and completed-task evidence, and deferred publication
through the existing writer/task-resource/CAS runtime. The reviewer keeps its
existing writer isolation contract while the separate non-writer database issue
remains unresolved. Independent revalidation checks exploit preconditions and
common repair; no finding quota was introduced.

The pinned `763e14b14` Git cohort reproduces all 14 distinct findings across 13
finding-bearing runs: 12 completed tasks and two open tasks. Eleven repair families
are proposed, including three native two-variant families; this does not demonstrate
three duplicate reviews or a measured capacity saving. The wider 28-run/87.1-minute
baseline remains attributed to the supplied task evidence until its original traces
can be inspected. The local Biome experiment distinguished its existing direct-HTTP
rule's positive/clean cases, but did not distinguish known vulnerable and repaired
native-authority snapshots; no additional scanner or rule was adopted.

Evidence, fix diffs, scanner results, and the detailed comparison are under this
run's `agent/security-review-evidence/`, including `review-summary.md`, `cohort.json`,
`scanner-experiment.json`, and validation logs. `pnpm check:fast` passed; 49 focused
owner tests, the blocking-worker integration test, and both workflow definition
validators passed. The enabled full publication scenario reaches task materialization
but cannot start runtime validation because its `/bin/ps` identity probe is denied.
The code's task identity, preservation, coverage, failed-review retry, and queued/
retained ownership decisions have separate passing behavioral proofs. Live agent
occupancy and production outcome improvement have not been measured.

Critic repair removes scanner classification from explicit-evidence admission:
reported paths receive semantic candidates, take priority within the bounded scan,
and retain cap-miss diagnostics. Explicit requests use the runtime's queue-all
admission so a later request cannot replace earlier critical evidence. The repaired
keyword-free boundary/replay and durable queue scenarios pass. The repair's focused
portfolio reports 46 passed and one failure at the same `/bin/ps` publication
barrier; the worker integration test and `pnpm check:fast` pass. Details are in
`agent/security-review-evidence/repair-summary.md` and `repair-owner-validation.log`.

The second critic repair persists partial explicit-request coverage by path and Git
content digest and lets dispatcher resume the remaining paths without routine
cooldown. Changed request content invalidates prior coverage. Admission and scanning
also inspect previously reviewed Git blobs, keeping removed authorization checks
eligible, and runtime retries rescan before investigation. The production workflow
scenarios cover a 36-path cap with an unreviewed path, failed continuation, content
change and replay, plus a real `retryOf` run at a newer head; modified and deleted
keyword-only guards remain due and selected. The owner portfolio reports 50 passed
and the same single `/bin/ps` publication failure; worker integration passes.
Details are in `agent/security-review-evidence/repair-2-summary.md` and its validation
logs.

The third critic repair retains established semantic surfaces alongside reviewed
content digests, so completed explicit reports remain reviewable after keyword-free
edits, deletion and recreation. Admission reads this retained identity directly;
reconstructing it from scanner matches on old blobs is removed. A production-workflow
regression first reproduced the critic's false-negative admission, then passed
through each content transition, failed-review retry and unchanged replay. The owner
portfolio reports 51 passed and the same single `/bin/ps` publication failure;
`pnpm check:fast` passes. Details are in
`agent/security-review-evidence/repair-3-summary.md` and its validation logs.

The fourth critic repair preserves pinned deletion evidence for every pending
request path, including unchecked paths and paths omitted by the candidate cap.
The extended batch-continuation regression reproduced the missing-digest scan
failure before the fix, then passed deletion, provider-failure retention, successful
consumption and unchanged replay. The affected security-review, publication and
dispatcher owner portfolio reports 61 passed and the same single `/bin/ps`
publication failure; `pnpm check:fast` passes. Details are in
`agent/security-review-evidence/repair-4-summary.md` and its validation logs.

The fifth critic repair separates unreviewed semantic observations from completed
coverage. Dispatcher persists observed boundaries before due events, partial reviews
retain unchecked/capped identity, and runtime retries replay initial review identity
before refreshing current Git content. New explicit requests now pin missing paths
as deletion evidence before scanning, including a first failed report retried after
deletion. Five focused cases reproduced the defects before the fix; the final six
regressions pass. The affected owner portfolio reports 65 passed and the existing
single `/bin/ps` publication failure; worker integration and `pnpm check:fast` pass.
Details are in `agent/security-review-evidence/repair-5-summary.md` and its logs.

## Live verification (2026-09-09 20:03 UTC)

The current daemon is loaded at 20:00:26.433Z on 1461431af. Public dispatch
started 2026-09-09T20-03-14-924Z-security-review-cumrjg. retain-review-input
returned a 472090-byte structured value. The runtime replaced it with its
262144-byte truncation marker while marking the step successful. The next step,
refresh-review-input, rejected that marker: missing required field evidenceRequest
(persisted output validation). The saved retain-review-input.json and metadata
prove the boundary failure; this was not a provider failure or absent evidence.
Another automatic attempt was admitted at 20:06:09 without a corrective change.

Reopen this existing task for a reproducible implementation defect, not a new
security finding. Keep replayable security identity and coverage in the existing
durable artifact/state owner and carry a bounded typed reference or summary across
steps; inspect the shared output/persistence contract before choosing the fix.
Do not increase caps, bypass validation, truncate unchecked security coverage,
or add a second state store. Use the actual runtime persistence boundary with
representative repository-sized evidence, not only an injected small fixture.
Prove initial review, retry and current-head refresh preserve all required
coverage, then complete the original publication and after-cohort acceptance.
The observations below remain acceptance work; they do not prevent repairing
this already evidenced failure now.

## Persistence repair (2026-09-09)

Run `2026-09-09T20-13-53-810Z-builder-eqwnyy` reproduced the live failure
through the real workflow executor and persisted metadata using a committed
2,500-path repository: retain-review-input succeeded with a truncation marker,
then refresh-review-input rejected the missing evidenceRequest field before
investigation. Both the semantic-surface map and Git-content map exceed the
unchanged 262144-byte step-output limit.

Initial identity and current-head input now remain in ordinary run artifacts.
Bounded typed run references and SHA-256 digests cross the step boundary;
reload validates integrity and the full schema. Runtime retry replays the
original reference and refreshes current Git content in its own run artifact.
Request and accumulated request-coverage maps also stay out of the exposed
candidate output. Publication and admission state remain with their existing
runtime owners; no output cap or review quota changed.

The repository-sized regression passes initial persistence, provider-failure
retention, retry at a changed head, guard removal and deletion, explicit request
consumption, and preservation of every unselected boundary. Missing and altered
retained artifacts fail closed without consuming coverage. The affected portfolio
had 72 passing tests and the same publication failure at the denied /bin/ps
identity probe; two additional negative persistence cases pass (74 distinct
passing owner cases total). The worker integration test, security-review
workflow definition validation, and pnpm check:fast pass. This distinguishes the
repaired persistence defect from the unresolved execution-profile prerequisite.

Evidence and before/after interpretation are in this run's
`agent/security-review-evidence/repair-summary.md`. The workspace workflow list
returns no security-review runs; canonical run-directory enumeration again
returns EPERM. No original transcript cohort or after-change live agent durations
were obtained, and no occupancy saving or production yield improvement is claimed.
These were partial implementation results, not a live outcome measurement.

## Historical disposition (2026-09-10)

Reopened for concrete post-integration defects. Prior persistence and coverage
repairs remain valid; the historical external capture is acceptance work, not a
reason to defer these fixes. Do not replace the established reviewer or add a
second finding database.

Run 2026-09-09T22-54-43-700Z-security-review-nrrakv and run
2026-09-10T00-19-55-369Z-security-review-qkfgdg both revalidate the existing
database-read task with evidenceIdentity native-nonwriter-database-read and
explicitly unchanged evidence. Their security-review-revalidation.json artifacts
use different strings: core/agent-harness/native-cli-sandbox versus
src/core/agent-harness/native-cli-sandbox; daemon-database-read-isolation versus
nonwriter-daemon-database-confidentiality. security-review-task-identity.ts hashes
the raw owner/invariant strings and then hashes excerpts. Semantic synonyms or
excerpt boundaries therefore create new family/evidence keys despite the same
nominated task. The total pending outbox grew from one to two; this is not proof
of two new vulnerabilities. Existing-family marker mismatch can also reject
publication. Verify that path rather than claiming it already occurred live.

Use stable canonical task/family identity and evidence lineage in the existing
materializer. Let the investigator distinguish a new variant or regression from
the known family, with references; code enforces identity, resource-safe updates
and replay. Prefix stripping or fuzzy-text suppression alone is insufficient.
Reconcile the observed pending entries through their owner without dropping a
distinct finding or altering the retained database builder's contract.

The same unreviewable mobile boundary digests recur after cooldown even without
new capability/evidence. Retain unknown coverage, but revisit settled unavailable
inputs when a relevant prerequisite, content or explicit request changes, not
simply because time passed. These runs also contained new paths; do not label
the entire batch a no-op. Report changed vs repeated coverage separately.

Missing artifact access belongs to the scoped evidence/recovery mechanism in
task-make-blocked-outcomes-actionable-and-recoverable; consume that boundary or
equivalent authorized exports, not raw database access. The existing Biome rule
is a narrow policy signal; the scanner experiment did not prove native sandbox
safety. Keep the documented no-adoption decision unless a new experiment shows
useful evidence. Prove synonymous repeated findings update/no-op once, a genuinely
new variant survives, held-owner publication defers safely, and failed reviews
retain unchecked coverage. Then measure a pinned live after-cohort honestly.

## Identity and unavailable-coverage repair (2026-09-10)

Run `2026-09-10T02-03-15-660Z-builder-59xofb` repairs the reopened implementation
issues. Revalidated task nominations now anchor canonical family identity;
evidence revisions survive owner/invariant synonyms and excerpt changes.
Explicit evidence lineage references retained evidence or historical finding ids.
New variants and regressions remain distinct. Existing pending entries migrate
without losing provenance and reconcile through the existing materializer;
active/retained task contracts remain under their resource owner.

Settled unavailable coverage retains content/prerequisite digests, rationale and
individually considered evidence requests. Cooldown expiry alone cannot readmit
it. Relevant content or prerequisite changes and unseen explicit requests can;
failed reviews retain unknown coverage. External capability changes use explicit
evidence requests. Outcome artifacts distinguish selected, revisited unavailable
and deferred unavailable paths. The scanner no-adoption decision is unchanged.

`pnpm check:fast`, the blocking-worker integration test and both definition
validators pass. The affected security-review/publication/dispatcher portfolio
reports 69 passing cases and the existing full-publication failure at
`spawnSync /bin/ps EPERM`. New production-workflow and materializer regressions
prove synonymous replay, one update/no-op, preserved variants, unknown coverage,
failed-review retry and individual pending-request consideration. The code is
retained safely; full production completion is not claimed.

Evidence and the pinned comparison are in this run's
`agent/security-review-evidence/review-summary.md`, `cohort.json` and validation
logs. The two reported recent run identities are pinned separately from the wider
supplied 28-run/87.1-minute baseline. Neither baseline transcripts nor live
post-change agent durations were obtained. No occupancy or yield improvement is
claimed. Canonical pending entries have not been mutated from this sandbox.

## Critic repair: legacy replay and recovery discovery (2026-09-10)

Legacy pending evidence now verifies its revision using the owner, invariant and
excerpts retained beside the original task hash. Synonymous later reviews cannot
reopen completed work by changing those hash inputs. Unverifiable legacy evidence
requires explicit revalidated lineage before mutation; pending provenance remains
with the publication owner. A new referenced variant still reopens the same task
and preserves the completed evidence. No canonical pending state was edited.

The regression reproduced reopening before the fix and now exercises version-1
pending migration against production-rendered legacy task evidence, multiple
excerpts, unchanged archive bytes, rejected unknown lineage and retained new
variants. The historical discovery probe returned operator-capture-due;
this was discovery, not acceptance evidence. Results remain in this run's
agent/security-review-evidence/repair-blocked-recovery.json and repair logs.

## Critic repair: completed partial-request coverage (2026-09-10)

Admission now respects each request's completed content coverage when deciding
whether it supplies unseen evidence, including explicit replays. A production
workflow regression reproduced repeated admission after one request reviewed A
and settled B unavailable, then another request settled unchanged A unavailable.
It now proves cooldown expiry and both request replays skip investigation, while
a new explicit request and changed content still admit review. `pnpm check:fast`
passes; the affected owner portfolio reports 82 passes and the existing single
publication failure at `spawnSync /bin/ps EPERM`. Evidence is in this run's
`agent/security-review-evidence/repair-2-summary.md` and its validation logs.

## Critic repair: pending lineage handoff (2026-09-10)

Independent revalidation now reconciles lineage into every matching pending
evidence entry before unchanged-evidence suppression or deduplication. Original
findings and run provenance remain pending for the existing publication owner;
the review outcome links those entries to the revalidation run. Review recording
does not mutate task contracts. Production-workflow/materializer regressions
cover both unchanged and new-variant recovery, multiple synonymous legacy entries,
preserved completed evidence and publication of a distinct finding. Validation
details are in this run's `agent/security-review-evidence/repair-3-summary.md`.
Canonical publication and live measurement were not observed in that attempt.

## Critic repair: historical replay after later completion (2026-09-10)

Completed-task replay protection now checks each retained evidence record.
Appending a versioned variant no longer disables the lineage requirement for
older unversioned evidence. The production materializer regression reproduced
the defect before the fix, then passed a second completion, rejection of an
unreferenced historical replay, unchanged referenced/versioned replays and a
further distinct variant. Retained legacy hashes also remain verifiable after
new evidence is appended; lossy historical evidence still requires lineage.
Validation is recorded in this run's
`agent/security-review-evidence/repair-4-summary.md`.

## Critic repair: unresolved pending identity isolation (2026-09-10)

Review recording, dispatcher routing and task publication now resolve pending
entries independently. Superseded or missing task nominations and invalid lineage
retain their original evidence and run provenance with a parking reason, while
independently confirmed findings enter the durable outbox. Historical nominations
cannot contaminate unrelated findings; valid lineage reconciliation and replay
suppression remain intact. The publication owner consumes only resolved evidence
for its task resource and still rejects an unresolved publication target.

The production review regression reproduced all three identity failures before
the fix. Publication replay exercises durable removal of only the valid entry,
retention of the unresolved entry, unchanged task contracts and rejection of the
unresolved target. Evidence and validation results are recorded in this run's
`agent/security-review-evidence/repair-5-summary.md`.

## Critic repair: independent same-task evidence publication (2026-09-10)

Pending evidence requiring lineage now parks before dispatch and publication,
while remaining available to independent revalidation. Valid variants can publish
to the same task without consuming unresolved evidence. Reopening for a versioned
variant preserves the older unversioned evidence's lineage requirement. Superseded
family markers no longer veto their canonical replacement; competing canonical
owners and direct superseded nominations still reject.

Both critic defects and the reopened-task replay defect were reproduced before
their fixes. The affected owner portfolio reports 91 passes and the existing
full-publication failure at `spawnSync /bin/ps EPERM`; `pnpm check:fast` and the
real blocking-worker integration test pass. A real worker also passes the targeted
task check against this workspace. The reported missing export names the separate
canonical checkout, whose code cannot be inspected or changed in this sandbox;
that runtime import failure is not claimed repaired by the local worker proof.
Details are in this run's `agent/security-review-evidence/repair-6-summary.md` and
its validation logs.

## Critic repair: changing batch eligibility (2026-09-10)

Publication now resolves each pending entry against the task after preceding
mutations. If appending a revision makes another legacy entry require lineage,
that entry remains pending with its provenance and parking reason; later valid
variants and unchanged replays continue through the existing materializer.
Only successfully materialized entries enter the staged outbox removal.

The production workflow and real blocking worker reproduced the critic's batch
abort before the fix. The repaired publication step processes the first revision,
parks the unresolved second revision, appends a third with validated lineage and
settles a replay without duplicating evidence. It preserves the original task
evidence and retains canonical pending entries until publication succeeds. Full publication still
reaches the existing denied process-identity probe. Validation and its limits are
recorded in this run's `agent/security-review-evidence/repair-7-summary.md`.
