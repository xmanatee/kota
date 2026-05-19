---
id: task-add-execution-intent-recall-eval-fixture
title: Add execution-intent recall eval fixture
status: done
priority: p2
area: modules
summary: Seed eval-harness with a long-horizon memory/recall fixture that proves KOTA can retrieve prior architectural decisions by execution intent, not only prompt keyword overlap.
created_at: 2026-05-19T20:37:40Z
updated_at: 2026-05-19T20:49:47Z
---

## Problem

KOTA has project-scoped memory, knowledge, history, task, and answer-history
contributors behind one recall seam, plus a recall tool and dynamic prompt
state that make those stores available inside sessions. The current coverage
proves the seam and the client surfaces, but it does not prove the long-horizon
behavior that matters during coding: a later task must recover a prior
architectural decision even when the user's current wording does not contain
the exact keywords that decision used.

The Continuity Benchmarks repo is a useful external signal because it isolates
"execution-intent memory": retrieval keyed to what the agent is about to do,
rather than blanket prompt-context retrieval. Its reported lift from targeted
retrieval reinforces a KOTA-specific gap: recall should be evaluated as an
agent-use behavior with distractors and delayed decisions, not only as a store
search API.

## Desired Outcome

Eval-harness includes a compact long-horizon recall fixture or focused
fixture-backed integration that proves a KOTA agent can use the existing
recall path to recover prior project decisions before making a code change.
The fixture should model noisy prior sessions or stored decisions, present a
later coding task whose correct patch depends on one hidden prior decision,
and reduce success to deterministic artifacts: the recall query/hits, the
final diff, and a predicate that fails when the retrieved decision is ignored.

## Constraints

- Use the existing memory, knowledge, history, tasks, and recall module seams.
  Do not add a parallel RAG store, benchmark runner, or prompt-summary surface.
- Do not blanket-inject all stored decisions into the agent prompt. If a new
  query-shaping helper is needed, keep it typed, observable, and local to the
  module that owns it.
- Keep scoring deterministic. Do not add an LLM judge as the only pass/fail
  signal; optional objective metrics must be secondary to a predicate.
- Respect eval-harness fixture provenance. Use an explicit smoke-fixture
  justification for a compact plumbing guard, or first record a real failing
  run if the fixture is meant to become regression-gated.
- Do not vendor Continuity Benchmarks or LongMemEval data. This is a
  KOTA-owned fixture inspired by the source, not an imported benchmark suite.
- Keep cost and leaderboard signals out of agent-facing context.

## Done When

- A new eval-harness fixture, or a focused eval-harness-backed module test,
  seeds multiple prior decisions plus distractors into the project-scoped
  stores and exercises the same recall provider/tool path used by sessions.
- The later task cannot pass by reading only the user prompt or by receiving a
  precomputed context summary; it must retrieve or otherwise surface the
  relevant prior decision through KOTA's recall path.
- The verification artifact records the recall query, ranked hits, final diff,
  predicate result, and fixture provenance.
- Existing recall and eval-harness tests stay green, and the new fixture is
  reachable through the standard eval-harness CLI if it is added as a fixture.

## Source / Intent

External discovery on 2026-05-19:

- https://github.com/Alienfader/continuity-benchmarks

The source is a reproducible benchmark for structured-knowledge retrieval in
long-horizon coding agents. It asks whether retrieval keyed to the pending
action improves correctness more than retrieval keyed only to the user's
prompt, with runners for action alignment, recall over noisy sessions, and a
LongMemEval-S subset. KOTA should not adopt its benchmark stack wholesale, but
the question maps directly onto KOTA's existing recall/memory architecture and
is not covered by the current queue.

## Initiative

Long-horizon coding-agent memory: KOTA should prove that its recall seam helps
agents preserve project decisions across sessions without turning memory into
undifferentiated prompt stuffing.

## Acceptance Evidence

- A `pnpm test ...` transcript or run artifact showing the focused recall /
  eval-harness tests passing.
- If implemented as an eval fixture, a `pnpm kota eval run --fixture <id>`
  artifact under `.kota/runs/<run-id>/` that includes the recall hits and the
  deterministic predicate result.
- The fixture notes cite the external Continuity Benchmarks source and explain
  why the chosen provenance shape satisfies `src/modules/eval-harness/AGENTS.md`.
