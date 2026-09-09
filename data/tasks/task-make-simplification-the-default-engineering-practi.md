---
status: open
priority: p1
---
# Make simplification the default engineering practice

## Problem

The owner wants maintainability and correct common owners, not task closure by
local patches, ever-longer prompts or numbered splits. Existing STANDARDS and
builder/critic guidance already permit proportionate proof; do not invent a claim
that they demand test counts. Yet contradictory guidance remains: gardener emits
all tests unchanged preservation claims, and STANDARDS links a verification
baseline through an abandoned worktree URI. Recent cleanup is real: the last 50
substantive commits through 763e14b14 add 4,070 production LOC but remove 20,447
test/support LOC. The problem is residual duplication and inconsistent decisions,
not universal growth or overlapping test portfolios (the static census found none).

## Desired Outcome

Make one concise engineering principle authoritative in existing repo guidance:
trace consumers and ownership first; choose the simplest cohesive solution;
share actual common behavior; preserve necessary variation; migrate callers and
delete the replaced path and redundant proofs in the same change. Use strict
types/standard tools for stable invariants and agent judgment for design choices.
Class hierarchies, schemas and protocols are means, not an OOP/SOLID checklist.
Do not require extracting a single-use abstraction or proving a new design through
a mandatory extra planning agent. Intentional no-change is a valid conclusion.

Rewrite conflicting/duplicated instructions in place across relevant AGENTS,
builder/critic/gardener prompts and standards; do not append the same manifesto
everywhere. Critic should reject duplicated authority, lost functionality and
unmigrated consumers when material, not bikeshed naming or punish a valid simpler
approach. A statement that tests pass is evidence of tested behavior only.

Demonstrate the principle on approval-queue's residual test boilerplate: 20 numbered
part files / 5,092 LOC at the audit head; 2,359 helper LOC; 41 unreferenced local
functions / 780 LOC; one 58-line daemon fixture repeated eight times. Inspect actual
callers before deletion. Retire dead helpers and duplicate list-behavior coverage,
share only useful fixtures, and organize remaining tests by real behavior. Keep
distinct HTTP/auth/wire/security proofs. Merely renaming part files is not cleanup.
Global 70% reduction remains owned by the existing closure task; this is one
bounded contribution, not a new reduction program or a waiver of its baseline.

## Constraints

- No mandatory test-per-module, file-size/LOC gates, blanket test reduction,
  source-string test of prose, or self-authored architecture-report protocol.
- Reuse existing typechecker, Biome, generators and gardener AST inspection;
  evaluate clone/unused checks as advisory diagnostics with dynamic roots handled.
- Keep metrics out of copied configuration test catalogs. Remove replaced tests
  where the shared owner now proves the same behavior, not their unique scenarios.

## How We Will Know

Show one source per durable convention, no stale worktree links in changed docs,
and lean role prompts. Public behavior remains covered once at its owner; the
approval-queue example has fewer maintained helpers and duplicate scenarios,
without hidden test skips or moved code excluded from the LOC census. Record
production/test/generated/support deltas separately and identify removed owners
and simpler consumers, not only a green suite or total line count.

## Research Basis

https://www.anthropic.com/engineering/harness-design-long-running-apps treats
harness components as assumptions to validate rather than accumulate.
https://jscpd.dev/getting-started/configuration provides clone diagnostics, not a
substitute for deciding whether similar code has the same responsibility.