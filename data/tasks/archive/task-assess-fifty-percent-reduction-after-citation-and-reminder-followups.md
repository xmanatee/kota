---
status: dropped
---

# Assess delivered simplification and preserve remaining cleanup work

## Disposition: Superseded, Goal Unmet

Dropped as superseded, not completed as goal achievement. The bounded assessment
is finished; the owner's minimum reduction is not delivered. Two independent
open p2 implementation tasks preserve demonstrated remaining work:

- `task-share-semantic-read-command-outcomes-across-channels`: remove duplicated
  query/default/unavailable/empty/reply policy for five existing read commands.
- `task-share-capture-retract-command-policy-across-channels`: remove duplicated
  capture/correction input policy and request/reply construction.

Both use the existing domain owners and channel adapters. Neither depends on
an aggregate measurement, live benchmark, or the other implementation; shared
channel-file edits use ordinary runtime reconciliation. The active queue and
inbox were checked for overlap. These are bounded opportunities, not a forecast
that they can close the remaining gap. No percentage-only successor, tracking
anchor, quota, or claim that necessary protections can safely be deleted is
introduced. No specific conflict proving the owner's floor impossible was
established; its feasibility remains unproven. The 70% stretch is also unmet.

## Attributable Aggregate

Assessed integrated revision: `feceeb978f3909842dcfc4d7a7bfb9f135e03ce3`,
this writer's source snapshot. All seven predecessor publications are verified
ancestors. Baseline: `fcaf40c60921445b1bfc7cb9ebac91013ce7f77a`.
The final result is **267,726 executable-test LOC**, a **20.0352% reduction**
(67,079 lines), **100,324 above** the 167,402 ceiling. The stretch ceiling
100,441 remains 167,285 lines away. The prior retained 266,089 result and
September 13 review's 266,114 are not substituted for this measurement.

| Category | Baseline | Assessed revision |
| --- | ---: | ---: |
| Executable test files | 1,353 | 1,277 |
| Executable test LOC | 334,805 | 267,726 |
| Original authored support LOC | 26,305 | 24,294 |
| Corrected authored support LOC | 27,917 | 26,063 |
| Generated/vendor exclusion LOC | 20,872 | 15,799 |
| Other production source LOC, original classification | 340,567 | 353,505 |
| Other production source LOC, corrected classification | 338,955 | 351,736 |

The unchanged recipe SHA256 is
`08d6b17c1f8e68d6b3bc77e05405d0a48c05c9b6750956776dcad89e536a505b`.
The run-local Python wrapper reads immutable Git blobs, reuses that recipe's
classification functions and universal-newline counting, and reproduces the
frozen baseline exactly. It avoids worktree artifacts and never reads runtime
state or environment files. Both revisions receive the same disclosed correction:
add `-fixture.integration.ts`, `-fixtures.integration.ts` and
`-test-tools.integration.ts` to support recognition. That moves 1,612 baseline
lines in eight files and 1,769 final lines in nine files from production to
support, leaving executable tests and exclusions unchanged. The previous audit's
1,751-line final correction describes its older revision, not this one.

Exclusions are initial snapshots 11,567 -> 7,415, generated mobile daemon
bindings 2,867 -> 1,135, and generated schemas 6,438 -> 7,249. Production counts
cover other `.ts/.tsx/.js/.mjs/.swift` sources under `src/` and `clients/`, as in
the earlier audit. Corrected production grew by 12,781 lines overall; unrelated
product and security work is included, so that is not a cleanup-only delta.
Main advanced during assessment to `e3ba13861` with a task-data-only publication;
these findings remain attributed to the pinned revision, without a rolling recount.

## Delivered Changes And Preserved Capability

The following net LOC changes are each publication against its own parent,
using the corrected categories. All exclusion deltas are zero.

| Predecessor publication | Tests | Support | Production |
| --- | ---: | ---: | ---: |
| Citation/reviewer evidence `1573e27e5` | +481 | +11 | +497 |
| Authorized tool consumers `b1233c5ca` | +22 | 0 | 0 |
| Issue observation `105f40d2a` | +131 | 0 | 0 |
| Reminder transitions `01702f30c` | -388 | 0 | 0 |
| Shared answer commands `2450f1495` | +113 | 0 | -55 |
| Workflow detail display `156994c76` | -132 | 0 | -128 |
| Runtime-copy retirement `3c6086df3` | 0 | +3,208 | 0 |
| Combined | +227 | +3,219 | +314 |

Answer commands now share validation, history defaults and domain reply handling;
workflow show consumes client detail without reconstructing synthetic storage
metadata. Together these remove 183 production lines net. This is concrete but
modest production simplification. The evidence repair added scoped handoff/read
authority and real consumer proof, outweighing those deletions; the seven-task
cohort is not a net source or test reduction.

The inspected reminder diff combines repeated transition observations while
retaining timer, bus and SQLite boundaries, persisted malformed-state rejection
and restart/history semantics. Authorization repair registers actual tool leases
and supplies the originating execution scope, preserving missing/changed-tool
rejection and session-local credentials. Issue tests now hold their fixture clock
inside retention and assert persisted aggregate state rather than incidental
signal counts. Citation fixtures ignore retained runtime evidence consistently
with production; the judge proof follows shared defaults to the adapter and
retains read-only authority and persistent evidence. These repairs preserve
necessary behavior and are not deletion opportunities merely because they add LOC.

Retirement removed 1,697 tracked run files / 12,236,833 bytes; the assessed tree
tracks none under `.kota/runs/`. A fresh comparison with immutable `52bc17b8d`
confirmed every original JSON field in both maintained replay captures is equal
apart from their added provenance. Their 116,691 bytes / 3,200 fixture lines,
plus eight helper lines, explain the support increase. No executable tests were
renamed or shifted into that category. This is honest repository-clutter removal,
not credit toward the executable-test target. Historical tracked originals remain
retrievable at that revision; private live retention was not accessed or altered.

## Validation And Limits

At the pinned source revision, **56 selected tests in nine files passed**:
14 scheduler/store cases establish transitions and durable reopen; three citation
cases exercise actual consumption/restart and later feedback; seven shadow-review
cases include propagation through the shared harness runner; seven adapter-resume
and six secrets cases exercise checkpointing, changed-tool rejection and credential
isolation; four issue-source cases check attribution and aggregate lifetime;
ten answer-owner cases check shared replies; five workflow-show command cases
exercise actual local/daemon client rendering, unknown costs, redaction and
artifact/chain options with controlled transport. This is focused feedback, not a
claim that all deterministic portfolios or live deployments passed.

The completed answer and workflow-detail records also retain their operator
transcripts: 26 answer replies with selected-scope persistence and denied routing,
and before/after workflow display showing restored tags and truthful missing data.
Those are predecessor-reported observations, not fresh live chat/daemon runs in
this assessment. The retirement predecessor reports its completion replay and
publication guard passing but a dead-letter replay timeout; the reminder record
reports HTTP/SSE `listen EPERM`. Neither unperformed journey is relabelled a pass,
and unchanged full portfolios were not rerun to rediscover those limitations.
The original audit's private run directory was inaccessible in this sandbox;
its archived task preserves the classification correction, and the fresh blob
census and comparison above independently reproduce the required evidence.

Only task Markdown changes in this assessment. `pnpm validate-tasks` passed,
checking path/id, metadata and dependency integrity; `git diff --check` also passed.
There is no changed runtime,
client contract or source behavior requiring a new build or live evaluation.
Run `2026-09-13T08-24-48-769Z-builder-gywioc` retains `measurement.json`,
`measure.py`, per-file blob/LOC census TSVs, `predecessor-deltas.json`,
`retirement-proof.json`, selected test results/log, and validation output.
The original contract follows to preserve the owner's intent.

## Goal

Keep necessary behavior while removing genuinely redundant verification and
needless supporting mechanisms. The owner's minimum is 50% executable-test
reduction, with 70% as a stretch. Neither percentage is a license to delete
useful protections or a per-child quota.

Baseline `fcaf40c60921445b1bfc7cb9ebac91013ce7f77a` has 334,805 executable-test
LOC. Use the frozen `scripts/count-verification-loc.py` recipe; the ceiling is
167,402. Report support, exclusions and production separately. Latest retained
audit `2026-09-12T22-32-50-597Z-builder-67j7si` recorded 266,089: target not met.
The original four proof repairs do not close that gap. The answer-command and
workflow-detail predecessors remove demonstrated production duplication; the
runtime-copy predecessor removes repository clutter without deleting evidence.
These are independent implementation tasks, not a claim that cleanup is finished.

The September 13 review at `ab2889452` counted 266,114 executable-test lines.
Twelve recent cleanup implementation commits removed a net 6,221 test lines but
added a net two production lines. That is real test reduction, not substantial
production simplification. Assess both dimensions and preserved capability.

Retain recipe SHA256
`08d6b17c1f8e68d6b3bc77e05405d0a48c05c9b6750956776dcad89e536a505b`.
The retained audit discloses missing integration support suffixes; reproduce
original and corrected support classifications consistently on baseline and
final. Baseline support/exclusions are 26,305/20,872; the pinned audit reports
21,075/15,791. Corrected support is 27,917 -> 22,826, with test LOC unchanged.
The detailed correction and per-file blob evidence stay in the retained audit.

## Bounded Assessment

After predecessors integrate, measure canonical once and review their outcomes.
Use existing verification and focused checks where changed behavior warrants
them. Do not repeat full portfolios to rediscover known unrelated failures.
Missing optional external benchmarks do not block this assessment.

If the goal is met, record it honestly. Otherwise identify concrete, useful
owner-sized simplifications or a specific conflict with preserving necessary
behavior. Publish independent follow-ups using existing task/decomposition
mechanisms and retire this assessment as superseded, not as goal achievement.
Do not implement the remainder of the repository in this task, reissue unchanged
audits, or block independent cleanup waiting for an aggregate numeric outcome.
Do not replace this with another percentage-only assessment. Any remaining
follow-up must own a concrete implementation outcome and name the duplicated
behavior or unnecessary mechanism it removes. Supersession preserves the unmet
owner goal; it never establishes completion. Necessary safety/behavior checks
take precedence over the numeric target, with any genuine conflict reported.

## Shared Verification Rules

Test public behavior at its narrowest sufficient owner. Keep composed tests only
for failures the owner checks cannot establish. Consolidate duplicated setup and
mechanisms when it actually simplifies maintained consumers; modest local fixture
duplication can be clearer than a universal test interpreter. Do not move tests
into support, minify, disable coverage or remove product behavior to improve LOC.
Give representative before/after observations, not a per-assertion evidence registry.

## Acceptance

One attributable aggregate result and a concrete disposition are published.
Unmet targets remain explicit; remaining actionable work reaches canonical task
files with sensible dependencies instead of being stranded in an audit artifact.
