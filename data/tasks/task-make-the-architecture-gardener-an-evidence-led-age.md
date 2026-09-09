---
status: open
priority: p1
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