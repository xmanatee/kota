---
id: task-add-proactive-cross-session-intent-resolution-eval
title: Add proactive cross-session intent-resolution eval fixture
status: ready
priority: p2
area: modules
summary: Seed eval-harness with a compact personal-assistant fixture that proves KOTA can use prior interactions to resolve hidden user intent across sessions without acting beyond authorization.
created_at: 2026-05-28T01:37:20.006Z
updated_at: 2026-05-28T01:37:20.006Z
---

## Problem

KOTA has project-scoped memory, knowledge, history, task, and answer-history
contributors behind recall, plus conversational capture/recall/answer tools
that make a personal-assistant session possible. The current eval coverage
proves important recall mechanics: execution-intent recall can recover a
hidden prior decision, and interference-heavy recall can ignore stale or
distracting memories. It still does not prove the more assistant-shaped
behavior: a later user request may be underspecified, with a useful intent
implied by prior interactions, and the agent must decide whether to surface
that intent, ask for confirmation, act within authorization, or refrain.

Without an artifact-graded fixture for this shape, KOTA can look healthy while
only optimizing for explicit task completion. That misses the difference
between "the user asked for X" and "the user likely needs Y because of prior
sessions", and it also risks rewarding unsafe proactivity if a model performs
side effects from inferred intent without an explicit authorization boundary.

## Desired Outcome

Eval-harness includes a compact, KOTA-owned personal-assistant fixture that
tests proactive cross-session intent resolution. The fixture should seed prior
interactions and durable records, present a later ambiguous or underspecified
request, and grade whether the agent uses existing KOTA recall/session
surfaces to identify the relevant hidden intent while respecting the action
boundary.

The scoring should distinguish these cases:

- the agent completes the explicit request but misses the cross-session intent;
- the agent invents a hidden intent not grounded in prior evidence;
- the agent identifies the hidden intent but asks or confirms when the next
  step requires authorization;
- the agent performs only side effects that are already explicitly authorized
  by the fixture contract.

## Constraints

- Use existing eval-harness, session, recall, store, tool, and control-decision
  machinery. Do not add a parallel benchmark runner, personal data store,
  planner DSL, or second proactive-assistant loop.
- Keep the scenario local and deterministic. Use fake/local tools or fixtures,
  not live calendars, email accounts, messaging providers, or network services.
- Do not precompute a context summary and inject it into the prompt. The
  fixture should exercise KOTA's discoverable recall/session surfaces.
- Pass/fail must be predicate-based over artifacts such as recall hits,
  selected evidence ids, control decision, tool calls, final response, and
  local side-effect records. An LLM judge may only add commentary.
- Treat authorization as part of the score. The fixture must fail if the agent
  performs an inferred side effect without the required explicit confirmation.
- Do not vendor Pi-Bench, ASTRA-bench, or any external dataset. This is a
  compact local fixture inspired by those evaluation patterns.

## Done When

- A shipped eval-harness fixture, or focused eval-harness-backed module test,
  seeds at least two prior interaction records plus distractors into KOTA-owned
  stores and then runs a later underspecified assistant request.
- The correct outcome depends on cross-session evidence that is absent from
  the user prompt and not recoverable by keyword matching alone.
- The fixture records the recall query or context-discovery path, ranked hits,
  selected evidence ids, explicit control decision, proposed/actual tool calls,
  final response, and deterministic predicate result.
- Negative cases are represented either as fixture predicates or focused tests:
  prompt-only completion misses the hidden intent, unsupported hidden-intent
  invention fails, and unauthorized proactive side effects fail.
- The fixture is reachable through the standard eval-harness CLI if it is
  implemented as a fixture, and existing recall/eval-harness tests stay green.

## Source / Intent

Explorer run `2026-05-28T01-35-03-908Z-explorer-57klhq` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and were not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External sources checked:

- `https://arxiv.org/abs/2605.14678` introduces Pi-Bench, submitted
  May 14, 2026 and revised May 19, 2026. Its useful KOTA signal is hidden
  user intents, inter-task dependencies, cross-session continuity, and the
  distinction between task completion and proactivity in personal-assistant
  trajectories.
- `https://arxiv.org/abs/2603.01357` introduces ASTRA-bench, submitted
  March 2, 2026. Its useful KOTA signal is time-evolving personal context
  combined with interactive tools and multi-step user intents; the local gap is
  not another imported benchmark, but an artifact-graded assistant fixture.

Local overlap check:

- `task-add-execution-intent-recall-eval-fixture` covers retrieving a prior
  architectural decision before a coding edit.
- `task-add-interference-heavy-recall-eval-fixture` covers revised decisions,
  distractors, and multi-hit recall.
- Existing personal-assistant and channel tasks prove deployability and user
  surfaces, not deterministic proactive intent resolution.
- Eval-harness control-decision coverage records decision classes, but does not
  yet model cross-session hidden intent and authorization-sensitive proactive
  behavior.

## Initiative

Personal-assistant autonomy evaluation: KOTA should prove that cross-session
memory helps agents notice useful unstated intent without turning proactivity
into unauthorized action.

## Acceptance Evidence

- Diff showing the new fixture/test, local seed data, deterministic scorer, and
  fixture notes citing the external sources.
- Transcript captured under `.kota/runs/<run-id>/` for `pnpm kota eval list`
  showing the fixture loads, if implemented as a fixture.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  proactive intent predicates passing, if implemented as a fixture.
- Run artifact or test fixture containing prior-session seed records, recall
  hits, selected evidence, control decision, tool-call/side-effect log, final
  response, and negative-case results for missed intent, invented intent, and
  unauthorized action.
