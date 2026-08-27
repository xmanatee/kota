---
status: done
---

# Separate task queue structure from autonomy governance

## Problem

`task-queue-validation.ts` mixes task schema/path/dependency validation with
autonomy prioritization, strategic ready coverage, documentation wording,
architecture-debt detection, Git status, completion evidence, and production
replacement execution. Repo-task structure and autonomous queue governance
therefore change through one 1,200-line policy file.

## Desired Outcome

Keep the repo-tasks module authoritative for task metadata, state, dependency,
safe file access, and transition invariants. Leave promotion/readiness strategy
with autonomy and architecture fitness rules with their owning compiler,
generator, schema, or linter. Retire task-authored production-replacement proof
instead of preserving a second test and execution protocol inside task moves.

## Constraints

- Preserve identity, path, dependency, blocked-precondition, and transition
  integrity without creating a second task schema.
- Queue structure remains deterministic and available without loading
  autonomy workflows.
- Promotion and strategic coverage consume the typed task-domain projection;
  they do not reread task files or reproduce actionability calculations.
- Normal owner-level validation and runtime behavior establish completion;
  task transitions do not interpret or execute a parallel proof language.
- Move callers before deleting mixed validation branches; no compatibility
  re-export file remains.

## How We Will Know

- Repo-task validation covers only structural/task-domain invariants.
- Autonomy owns prioritization, coverage, and promotion policy.
- Architecture checks own source-layout and single-mechanism enforcement.
- Validation output and exit behavior remain available through one command
  without a second task validator.
- The mixed-responsibility implementation is removed and each rule has one
  source-level owner.

## Source / Intent

Owner-approved targeted rewrite from the 2026-08-24 audit. The current task
validator remains valuable; the problem is that unrelated product and autonomy
policy accumulated in its structural boundary.

## Initiative

One task schema and clear task/autonomy/architecture ownership.

## Acceptance Evidence

- Before/after task-validation corpus covering valid and invalid queues,
  dependencies, transitions, strategic coverage, and replacement proof.
- Import/ownership report mapping every former rule to exactly one component.
- Standard `pnpm validate-tasks` transcript proving the composed public command
  remains the single entry point.

## Result

Repo-task validation now checks task identity, metadata syntax, state/path
agreement, priority and timestamps, dependency existence and acyclicity,
blocked preconditions, duplicate IDs, and runtime-state path safety. It no
longer evaluates task prose, task classes, queue quotas, strategic coverage,
architecture source scans, rendered evidence, Product/Safety links, or source
access claims.

Autonomy ranks promotable work by authored priority, age, and stable ID, then
uses task-domain dependency and anchor projections. The task-authored
production-replacement proof language, completion gate, assertion executor,
rendered-evidence parser, autonomy-change source classifier, and their fixture
interpreters were removed rather than moved behind another abstraction.
