---
id: task-add-interference-heavy-recall-eval-fixture
title: Add interference-heavy recall eval fixture
status: done
priority: p2
area: eval-harness
summary: Seed eval-harness with a memory/recall fixture that proves KOTA handles revised decisions, distractors, and multi-hit aggregation rather than only single static recall.
created_at: 2026-05-19T21:14:58Z
updated_at: 2026-05-19T21:26:26.700Z
---

## Problem

KOTA now has coverage for execution-intent recall: a later coding task can
recover one relevant prior decision through the existing recall path even when
the prompt uses different words. That closes the first Continuity Benchmarks
gap, but it still models a mostly static single-target memory problem.

Long-running KOTA sessions and autonomous workflows have a harder failure
mode: earlier decisions get revised, unrelated stores accumulate similar
distractors, and the correct action may depend on combining two or more
retrieved facts. A recall path that passes a single hidden-decision fixture can
still choose stale or semantically-near guidance when memory is noisy.

## Desired Outcome

Eval-harness includes a compact interference-heavy recall fixture that proves
KOTA can retrieve and apply the current relevant project decisions under
noisy, evolving memory conditions. The fixture should seed multiple prior
decisions, at least one later revision that supersedes an earlier rule,
similar distractor records across memory / knowledge / history / tasks where
useful, and a later coding task whose correct patch requires current evidence
rather than the nearest old memory.

## Constraints

- Use the existing recall contributors, project-scoped stores, and
  eval-harness fixture machinery. Do not add a parallel memory store, benchmark
  runner, or prompt-summary surface.
- Keep the fixture deterministic. The pass/fail predicate must inspect
  artifacts such as recall hits, selected evidence ids, final diff, and
  command output; an LLM judge may only be secondary commentary.
- Model revision explicitly. The fixture must fail if the agent follows an old
  superseded decision even when that decision is semantically close to the
  task.
- Include a multi-hit case. At least one assertion should require combining
  two current pieces of evidence, not only selecting one record.
- Do not vendor LongMINT, LongMemEval, or other external datasets. This is a
  KOTA-owned compact fixture inspired by those evaluation patterns.
- Keep cost and benchmark-leaderboard language out of agent-facing context.

## Done When

- A shipped eval-harness fixture, or focused eval-harness-backed module test,
  seeds revised decisions and distractors into KOTA's own stores and exercises
  the same recall path used by sessions.
- The resulting task cannot pass by reading only the user prompt, by receiving
  a precomputed context summary, or by using the first semantically similar old
  record.
- The verification artifact records the recall query, ranked hits, which hit
  ids were treated as current evidence, which stale hits were ignored, the
  final diff, and the deterministic predicate result.
- Existing recall and eval-harness tests stay green, and the new fixture is
  reachable through the standard eval-harness CLI if implemented as a fixture.

## Source / Intent

External discovery on 2026-05-19:

- https://arxiv.org/abs/2605.18565
- https://github.com/Alienfader/continuity-benchmarks

LongMINT evaluates memory under multi-target interference in long-horizon
agent systems, including revised information, noisy long contexts, GitHub
commit domains, single-target recall, and multi-target aggregation. The useful
KOTA signal is not to import that benchmark, but to cover the next recall
failure class after execution-intent retrieval: stale or interfering evidence
must not override current project decisions.

Continuity Benchmarks remains relevant as the execution-intent source, but its
direct KOTA follow-up already landed as
`task-add-execution-intent-recall-eval-fixture`. This task intentionally covers
the separate revision/interference case.

## Initiative

Long-horizon coding-agent memory: KOTA should prove that recall preserves
current project decisions across noisy sessions, revisions, and distractors
without turning memory into undifferentiated prompt stuffing.

## Acceptance Evidence

- A `pnpm test ...` transcript or eval-harness run artifact showing the
  interference-heavy recall fixture passing.
- The run artifact includes the seeded stale/current/distractor records, recall
  hits, evidence selection, final diff, and predicate result.
- The fixture notes cite the LongMINT and Continuity Benchmarks sources and
  explain why the compact KOTA-owned provenance shape satisfies
  `src/modules/eval-harness/AGENTS.md`.
