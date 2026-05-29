---
id: task-add-eval-harness-environment-state-audit-predicate
title: Add eval-harness environment-state audit predicates
status: ready
priority: p2
area: modules
summary: Extend eval-harness fixture predicates so native-runtime scenarios can assert expected and forbidden local environment side effects, not only git diffs, bus events, or external command calls.
created_at: 2026-05-29T07:22:48.184Z
updated_at: 2026-05-29T07:22:48.184Z
---

## Problem

KOTA's eval harness has artifact predicates for files, git change scope, bus
events, and external command logs. That covers many workflow and builder
failures, but it leaves a gap for native-runtime scenarios where the important
outcome is the shape of local environment state after the agent runs: fake
mail/calendar/task stores, local service ledgers, approval queues, browser-like
session stores, or other fixture-owned side-effect records.

Fixture authors can work around this with bespoke shell scorers, but that makes
side-effect expectations harder to discover, harder to report consistently, and
easier to water down into prose. KOTA needs a small typed predicate surface for
expected and forbidden local environment-state deltas.

## Desired Outcome

Eval-harness fixtures can declare deterministic environment-state audit
predicates that compare fixture-owned local state after a run against explicit
expected and forbidden effects. The predicate should be useful for native-runtime
fixtures without becoming a benchmark runner, a general assertion DSL, or an LLM
judge.

The finished surface should let a fixture express, for example, that a workflow
created exactly one expected local message record, updated a task-state ledger,
and did not write an unauthorized side-effect record. Predicate results should
appear in the same fixture-run artifacts and aggregate reports as the existing
predicate kinds.

## Constraints

- Keep this inside `src/modules/eval-harness/`; do not add a parallel metrics
  store, benchmark import path, or external side-effect recorder.
- The audit must be local to the materialized fixture working directory. It
  must not read the operator's real `.kota/` state, home directory, browser
  profile, network services, or credentials.
- Prefer one typed predicate contract over arbitrary fixture-specific prose or
  a stringly assertion language. Malformed audit data should fail loudly with a
  useful predicate detail.
- The predicate should support both positive assertions (expected state/effects
  exist) and negative assertions (forbidden state/effects are absent).
- Do not add an LLM/VLM judge. If a fixture needs semantic review later, that
  should remain a separate explicit evaluator decision.
- Keep existing predicate behavior and fixture compatibility intact.

## Done When

- Eval-harness predicate types, loader validation, evaluator, and reporting
  support a typed environment-state audit predicate or an equivalently named
  local-state predicate.
- Focused tests cover passing audits, missing expected effects, present
  forbidden effects, malformed audit artifacts, and path traversal or
  out-of-working-dir rejection.
- At least one small smoke fixture or existing fixture uses the predicate to
  prove the contract end to end, including a pre-run expectation that fails
  before the agent/workflow run and a final predicate that passes after the
  expected local state is produced.
- The implementation keeps predicate results deterministic and artifact-based;
  agent summaries and LLM judge output are not accepted as pass/fail evidence.
- `pnpm kota eval list` loads the fixture set without provenance or schema
  errors.
- A targeted test command and one fixture run demonstrate the new predicate in
  the acceptance evidence.

## Source / Intent

Explorer run `2026-05-29T07-21-01-968Z-explorer-4ufxgc` found the actionable
queue empty while all surfaced strategic blocked alternatives were waiting on
operator-captured evidence. The run reviewed WildClawBench as a current
native-runtime agent-evaluation signal:

- `https://arxiv.org/abs/2605.10912` presents WildClawBench as a benchmark for
  real CLI-harness agents running long-horizon tasks with real tools.
- `https://github.com/InternLM/WildClawBench` documents its grading mix:
  deterministic checks, environment-state auditing of side effects, and
  optional semantic judging across OpenClaw, Claude Code, Codex CLI, and Hermes.

The KOTA-relevant takeaway is not to import WildClawBench or copy its
leaderboard. The local gap is narrower: KOTA's eval-harness predicate contract
should make side-effect state audits a first-class deterministic artifact for
native-runtime fixtures.

## Initiative

Outcome-grade autonomy evaluation: KOTA should score native-runtime agent
behavior by inspecting concrete local effects, including the absence of
unauthorized side effects, instead of relying only on git diffs, event logs, or
agent self-report.

## Acceptance Evidence

- Diff showing the typed predicate contract, evaluator, loader validation,
  report serialization, tests, and the fixture or fixture update that exercises
  the contract.
- Transcript under `.kota/runs/<run-id>/` for the targeted predicate/fixture
  tests.
- Transcript under `.kota/runs/<run-id>/` for `pnpm kota eval list` showing the
  fixture set loads.
- Transcript and fixture-run artifact under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <state-audit-fixture-id> --repeats 1` showing
  the environment-state audit predicate passing and reporting useful details.
