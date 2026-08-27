---
id: task-build-an-architecture-gardener-for-continuous-simp
title: Build an Architecture Gardener for continuous simplification
status: ready
priority: p1
area: architecture
task_class: Platform
summary: Add one evidence-driven architecture-gardening loop that finds, explains, deduplicates, and safely routes high-value simplification opportunities through KOTA's existing automation system.
created_at: 2026-08-27T02:02:52.000Z
updated_at: 2026-08-27T02:02:52.000Z
---

## Problem

KOTA has an improver for durable autonomy failures, scope and progress
reviewers, diff-hygiene checks, fixture-local code-health diagnostics, and a
lean behavioral-verification program. It does not have one coherent mechanism
that continuously discovers and verifies opportunities to simplify
architecture, concepts, ownership, abstractions, implementation approaches,
and tests.

Individual metrics are insufficient evidence. A scheduled LLM review or a
single global simplicity score would create noisy tasks, reward superficial
changes, and risk autonomous rewrites that preserve a metric while degrading
behavior or ownership clarity.

## Desired Outcome

Add one Architecture Gardener vertical slice that uses KOTA's existing module,
workflow, run-state, generated-work, builder, validation, and integration
boundaries. It should:

- collect typed, deterministic architecture observations, initially covering
  AST-backed module dependencies and canonical ownership;
- suppress unchanged evidence through stable fingerprints and material-delta
  checks;
- admit semantic review only for an explicit request or convergent,
  materially changed signals;
- express each admitted opportunity as a falsifiable
  `SimplificationHypothesis` with a behavior-preservation claim and a named
  structural improvement;
- create at most one normal implementation task for an accepted hypothesis,
  using the existing generated-work and builder path;
- expose operator-readable status explaining evidence, disposition, and
  suppression through the normal CLI/API/UI contribution surfaces.

The mechanism should prefer deletion, ownership collapse, and removal of
obsolete paths. A new abstraction is justified only when it replaces at least
two real maintained implementations or owners, names a stable variation axis,
leaves consumers simpler, and has one canonical owner.

## Constraints

- Preserve `improver` as the owner of autonomy failures. Architecture
  opportunities are a separate domain and must not become a second improver.
- Do not add another automation engine, queue, operational database,
  publication mechanism, or implementation path.
- A single file-size threshold, churn value, clone count, review score, test
  count, or other advisory metric must never create work by itself.
- Do not autonomously rewrite arbitrary code. Novel changes remain ordinary
  tasks implemented by `builder` and reviewed through existing gates.
- Permit automatic codemods only for narrow, idempotent TypeScript AST
  transformations whose pattern has already succeeded repeatedly under normal
  review and verification.
- Integrate with the lean behavioral-verification program instead of creating
  another test optimizer.
- Store durable observation state as a revisioned run-state projection and
  retain detailed evidence in run artifacts; do not create parallel JSON
  authority.
- Use stable fingerprints, cooldowns, material-delta checks, and logical
  resource keys so unchanged or competing candidates do not repeatedly wake
  agents or create duplicate tasks.

## How We Will Know

- An explicit owner request produces one typed simplification hypothesis and
  no more than one normal task.
- One advisory metric alone produces no task; two independent eligible signals
  can admit review.
- Replaying unchanged evidence produces no new semantic review or task.
- The initial AST provider detects forbidden core-to-module dependencies,
  undeclared runtime cross-module imports, module cycles, and duplicate
  canonical ownership from typed program and module metadata rather than
  regular-expression source scans.
- Every accepted change preserves declared behavior, improves its named
  structural dimension, avoids protected-invariant regressions, and removes or
  bounds the retired path without leaving permanent dual ownership.
- CLI/API/UI status explains why each candidate was accepted, rejected,
  deferred, cooled down, or deduplicated.
- Focused tests cover admission, fingerprint suppression, proposal
  creation/deduplication, protected fitness functions, and the Pareto
  comparator without duplicating generic workflow-runtime tests.

## Source / Intent

Preserve the owner goal: automate continuous generalization, optimization, and
simplification of concepts, tests, abstractions, structure, and approaches
while keeping changes safe, behavior-preserving, and explainable.

Start from:

- `docs/ARCHITECTURE.md`
- `docs/STANDARDS.md`
- `src/modules/autonomy/workflows/improver/AGENTS.md`
- `src/modules/eval-harness/code-health-diagnostics.ts`
- `data/tasks/backlog/task-lean-behavioral-verification-program.md`

The design should apply architectural fitness functions, typed automated
refactoring, relative change-risk signals, stable finding identity, and
Pareto-style acceptance rather than a universal maintainability score. The
research basis includes Thoughtworks architectural fitness functions, Google
ClangMR/Refaster/Tricorder, OpenRewrite recipe safety, Meta Getafix, Microsoft's
relative-churn and test-selection work, Google's test-size guidance, and
mutation testing.
