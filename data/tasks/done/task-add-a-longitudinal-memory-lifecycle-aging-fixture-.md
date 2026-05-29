---
id: task-add-a-longitudinal-memory-lifecycle-aging-fixture-
title: Add a longitudinal memory-lifecycle aging fixture to the eval harness
status: done
priority: p2
area: modules
summary: Add a compact eval-harness fixture that measures whether KOTA recall and session memory retain, revise, and recover evidence across repeated sessions and a controlled maintenance shock, with stage-local diagnostic artifacts instead of a one-shot recall pass.
created_at: 2026-05-29T04:06:51.859Z
updated_at: 2026-05-29T04:19:35.256Z
---

## Problem

KOTA now has several focused recall and memory eval slices: execution-intent
recall, interference-heavy recall, proactive cross-session intent resolution,
and core/session compaction tests. Those are valuable, but they are still
mostly point checks. They prove that a stored fact can be recovered in one
later situation, or that compaction preserves a specific shape, not that a
long-lived KOTA agent remains reliable as state accumulates, facts revise, and
routine maintenance changes the memory/session substrate.

AgingBench makes this gap concrete. Its useful signal for KOTA is not another
benchmark import; it is the longitudinal framing: agent reliability is a
property of the full harness and memory lifecycle, not only a day-one model
score. It separates compression, interference, revision, and maintenance
aging, and diagnoses whether the failure came from writing, storing,
retrieving, or using evidence. KOTA has pieces of those checks, but not one
compact fixture that follows the same evidence across multiple sessions and a
controlled maintenance shock.

## Desired Outcome

Add a compact KOTA-owned eval-harness fixture, or a narrowly fixture-backed
module test if the current fixture runner cannot express the sequence, that
measures memory-lifecycle aging across repeated sessions.

The scenario should seed and exercise:

- a fact or project decision that starts correct, is revised later, and is
  queried after similar distractors accumulate;
- at least three sequential session/checkpoint phases so the artifact shows a
  reliability curve rather than one final recall result;
- one controlled maintenance event such as context recompaction, working-memory
  compaction, history replay/resume, or store cleanup that should not silently
  erase or stale the target evidence;
- per-checkpoint diagnostics for write/store/retrieve/utilize: what was
  written, what persisted after the lifecycle event, which recall hits ranked,
  and whether the final response or patch used the current evidence.

Success should reduce to deterministic artifacts and predicates. The fixture
should fail if KOTA can answer the first checkpoint but later follows a stale
revision, loses a low-frequency detail through compaction, buries the target
behind distractors, or survives only by receiving a precomputed context
summary.

## Constraints

- Use KOTA's existing eval-harness, recall contributors, stores, history,
  working-memory/session compaction, and predicate/objective-metric paths.
  Do not vendor AgingBench, import its datasets, add an AgingCard schema, or
  create a second benchmark runner.
- Keep the scenario small enough for a normal eval-harness smoke run. This is
  a local canary for memory-lifecycle behavior, not a suite of many scenarios
  or a leaderboard.
- Do not blanket-inject the target facts into the prompt. The later checkpoints
  must recover them through KOTA's normal discoverable recall/session surfaces.
- Keep scoring predicate-based. Optional objective metrics may report
  checkpoint pass rate, stale-hit count, recall precision, or post-shock
  recovery, but pass/fail must inspect concrete artifacts.
- Treat maintenance-shock evidence explicitly. If a lifecycle event is skipped
  because the current runner cannot trigger it, the fixture must record that
  as unsupported rather than silently claiming maintenance-aging coverage.
- Keep cost, model ranking, and provider-optimization language out of
  agent-facing context.

## Done When

- A fixture or focused eval-harness-backed test creates a multi-checkpoint
  memory lifecycle scenario with revision, distractors, and a controlled
  maintenance event.
- The run artifact records checkpoint-by-checkpoint evidence for writes,
  persisted records after maintenance, recall queries and ranked hits, selected
  evidence ids, final response or patch behavior, and predicate results.
- Deterministic negative checks fail for stale-revision use, target evidence
  loss after maintenance, and prompt-only success without recall/session
  discovery.
- If implemented as a fixture, `pnpm kota eval list` loads it and
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` produces the
  lifecycle diagnostics artifact.
- Existing recall, history, working-memory, and eval-harness focused tests stay
  green.

## Source / Intent

Explorer run `2026-05-29T04-04-25-304Z-explorer-aw7h5x` received an empty
actionable queue: `ready=0`, `doing=0`, and the two backlog research tasks are
hard dependency-waiting on
`task-enable-autonomous-access-to-auth-walled-sources-so`. The surfaced
strategic blocked alternatives all still require operator-captured evidence
and were not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External sources checked:

- `https://arxiv.org/abs/2605.26302` introduces AgingBench / agent lifespan
  engineering, submitted May 25, 2026. Its useful KOTA signal is longitudinal
  degradation across compression, interference, revision, and maintenance
  mechanisms, with diagnostics tied to write/retrieve/utilize stages.
- `https://agingbench.github.io/` describes AgingBench v0.3.0, including
  multi-session reliability curves, memory-policy effects, maintenance shocks,
  and a coding-agent scenario.
- `https://github.com/VITA-Group/AgingBench` shows the public benchmark code
  and documents scenario mode, telemetry mode, and the four aging mechanisms.

Local overlap check:

- `task-add-execution-intent-recall-eval-fixture` covers action-keyed recall of
  one prior decision.
- `task-add-interference-heavy-recall-eval-fixture` covers stale decisions,
  distractors, and multi-hit aggregation.
- `task-add-proactive-cross-session-intent-resolution-eval` covers hidden
  assistant intent and authorization-safe proactivity.
- Core/session and working-memory tests cover compaction mechanics, but not a
  longitudinal recall/revision/maintenance fixture with per-checkpoint
  diagnostic artifacts.

This task is the smallest nonduplicative local slice: a memory-lifecycle
aging canary inside the existing eval-harness path.

## Initiative

Long-horizon autonomy memory: KOTA should prove that project memory and
session state remain usable across repeated sessions, revisions, and routine
maintenance events without relying on precomputed context summaries or
one-shot recall success.

## Acceptance Evidence

- Diff showing the new fixture/test, local seed data, deterministic predicates
  or scorer, and fixture notes citing the AgingBench sources.
- Transcript captured under `.kota/runs/<run-id>/` for `pnpm kota eval list`
  showing the fixture loads, if implemented as a fixture.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  longitudinal memory-lifecycle predicates passing, if implemented as a
  fixture.
- Run artifact or checked fixture output containing checkpoint diagnostics:
  writes, stored records after maintenance, recall hits, selected evidence,
  final response or patch behavior, objective metrics if present, and negative
  stale/lost/prompt-only cases.
