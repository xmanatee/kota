---
status: done
---
# Make the architecture gardener an evidence-led agent

## Problem

An architecture-gardener module already exists. Do not add another platform bot.
At 763e14b14 its workflow has eight code steps and no agent. hypothesis.ts selects
designs through summary.includes and supplies a default preservation claim;
pareto.ts treats that nonempty claim as evidence and scores deletion highest.
An explicit empty observation can yield zero actions yet accepted score 100 and
invariants preserved. evaluateArchitecturalFitness has no production callers.
There are zero gardener runs in retained August 26-September 9 runtime history.
The request-only trigger has no automatic producer; CLI/route requests omit the
event's required scopeId, and the CLI uses an unbound commands-mode event context.

## Desired Outcome

Reuse this owner for a thin internal platform-engineering function. Static code
collects observations; an agent investigates real callers and implementations,
compares simpler alternatives, rejects false positives and proposes an outcome-
sized consolidation only where it reduces maintenance burden without losing
behavior. Fix existing scoped CLI/API trigger plumbing through normal dispatch.
Automatic admission consumes materially new structural and delivery-friction
evidence through existing runtime state, not a per-N or periodic AI review.

Keep useful AST ownership/dependency/cycle checks. Replace fabricated semantic
hypotheses, preference scores and preservation conclusions with honest observed
facts, proposed changes and unverified expectations. An unmeasured future result
is not an accepted Pareto improvement. Remove orphaned alternative fitness
paths, unused schemas/helpers and their implementation-pinning tests.

Prioritize harvested common mechanisms, not a speculative universal module SDK.
Concrete candidates found by this audit are anchored record I/O, shared route
invocation and scope selection; separate implementation tasks already own them.
Correlate clone/unused-symbol/change-fanout signals with real ownership and caller
evidence. File size, clone count and LOC are triage aids, not merge vetoes or task
quotas. Permit no action. Follow a chosen change to migrated callers, retired
paths, proportionate proof and an actual simpler result using existing topic/task
state; do not create a parallel improvement ledger.

## Constraints

Retain common isolation, scoped read authority and generated-work publication.
The gardener proposes; builders implement. No additional planner/critic workflow
is mandatory for every build. Do not regenerate existing active cleanup tasks.
New abstraction requires real common behavior and a stable variation point;
preserve domain-specific behavior rather than flattening unlike concepts.

## How We Will Know

Exercise public scoped request -> admitted run -> agent investigation -> existing
proposal materializer or justified no-action. Empty observations cannot become a
verified improvement. Changed evidence can admit once; unchanged observations,
restart and multiple request surfaces do not duplicate work. Reproduce one genuine
two-consumer opportunity and one false-positive example. Record a live grounded
decision and verify all removed inference paths have no production callers.

## Research Basis

https://martinfowler.com/bliki/HarvestedPlatform.html and
https://teamtopologies.com/key-concepts support extracting a thin platform from
real consumers. https://knip.dev/explanations/how-knip-works explains why dynamic
entrypoints must be understood before deleting apparent unused code.

## Completion evidence

Repair investigation recorded 2026-09-09T18:05:37Z in the existing builder run.
The investigator was the live builder agent following the gardener prompt,
reading implementations and callers before deciding. This was not a separately
launched gardener provider session. The public scoped request/runtime journey
uses a controlled model port; its passing test proves composition, not judgment.
The following real-source reproductions supply the judgment evidence separately.

The genuine opportunity is anchored record I/O. ApprovalQueue constructs
ApprovalRecordStorage at `src/core/daemon/approval-queue.ts:116` and hands it to
ApprovalRecordRepository. OwnerDecisionStore does the corresponding construction
at `src/core/daemon/owner-decision-store.ts:104`. Both repositories call the
storage implementations' read/list/write/clear methods. Running both actual
storage classes exercised create/read/update/list/clear and hard-link rejection.
Running their unchanged exported subprocess helper sources with only the OS I/O
port instrumented produced these observed events:

| Actual helper | Successful write syncs | Injected zero-progress write |
| --- | --- | --- |
| Approval | file, directory | One write; returns `ok:false`, `approval record write made no progress` |
| Owner decision | file | Attempts a second write; bounded probe throws there to stop the repeated zero-write loop |

The implementations are `src/core/daemon/approval-record-storage-helper-source.ts`
(`writeAll`, line 145; directory sync, line 180) and
`src/core/daemon/owner-decision-record-storage-helper-source.ts` (write loop,
line 150; file sync, line 152). The probe uses the current sandbox, empty child
environments, and scratch records; it does not touch live daemon records.
Leaving both mechanisms retains observed security-sensitive drift; deleting one
breaks a maintained consumer. Harvest the common descriptor/identity/I/O/process
mechanism while retaining domain decoding, signatures and lifecycle at the two
repositories as the stable variation point. Migrate both callers, retire the
replaced helpers and prove link/identity replacement rejection, write progress,
durability and domain lifecycle behavior. The existing active task
`task-unify-anchored-record-storage-for-decision-owners` already owns that outcome.
The decoded decision was `covered`; production materialization returned that
same task id with `proposalKey:null` and `touchedTaskQueue:false`.

The false positive was reproduced by the production observation collector:
`obs-undeclared-a4e0ec75` reports the dynamic harness import at
`src/modules/autonomy/autonomous-loop.integration-test-helpers.ts:33`.
Inspecting importers found five integration-test consumers: autonomous-loop,
autonomy-issue-lifecycle, autonomy-issue-reconciliation,
autonomy-owner-answer-lifecycle and production-dead-letter-routing-replay.
Resolving the canonical `tsconfig.build.json` into a complete TypeScript program,
including transitive imports, excluded the helper. Adding a production dependency
would change load ordering for test-only behavior; deleting the helper would
break real integration callers. The separately decoded decision was `no-action`;
production materialization returned null task/proposal ids and
`touchedTaskQueue:false`. The complete task snapshot was equal before and after
both decisions. No extraction, preserved future invariants, delivery-incident
causation or measured maintenance saving is claimed.

Run evidence under `$KOTA_RUN_DIR/artifacts/`: `gardener-reproduction.mjs` is the
rerunnable OS-port probe; `gardener-reproduction-transcript.json` contains its
observed outputs; `gardener-source-snapshot.json` retains inspected source and
SHA-256 hashes; `gardener-observations.json` pins the scan;
`gardener-live-decision-transcript.json` records both judgments, production
materialization and the admission cohort. The cohort admitted an explicit request
once and rejected its unchanged repetition. This note preserves the substantive
results with the task even when a reviewer cannot access an external run path.

Validation: 16 gardener owner checks and the public scoped request integration
passed; the latter exercises CLI/API dispatch, one investigator invocation,
transactional settlement and rejection of malformed/unknown-scope requests.
Production source search found no retired hypothesis/Pareto/fitness/codemod
imports or inference entrypoints. No new mechanical tests were added.

The second critic repair fixes scoped admission losing module imports and clone
sites before fingerprinting. Observations now carry typed affected source paths
or owning directories; module-name and repository-path requests resolve to the
same cohort key. Shared clone, cycle and ownership evidence retains every
participant. Delivery evidence remains available as repository-wide context.

The production workflow regression starts with an explicit review, introduces
an unrelated sibling import (suppressed), then a target import and a cross-tree
clone (each admitted once). It exercises directory, module-name and file targets,
reopens persisted state between requests, suppresses unchanged repetitions and
equivalent path spelling, and confirms no task creation for no-action decisions.
The collector regression checks both owners of cycles and duplicate contributions
while excluding unrelated targets. These distinguish lost relevant evidence from
overbroad admission. All 20 gardener owner tests and the scoped API/CLI integration
test passed, as did production/test typechecking and gardener Biome checks. The
integration test controls the model port; this repair makes no new claim about
live model judgment.
