---
id: task-add-a-dialogue-driven-coding-agent-fixture-to
title: Add a dialogue-driven coding-agent fixture to the eval harness
status: ready
priority: p2
area: modules
task_class: Meta
summary: Seed an eval-harness fixture where a coding agent must use a bounded, scripted user dialogue to resolve an ambiguous task before patching, so dialogue quality is artifact-graded separately from autonomous patch success.
created_at: 2026-06-20T20:54:53.314Z
updated_at: 2026-06-20T20:54:53.314Z
---

## Problem

KOTA has strong coverage for autonomous builder outcomes, artifact-first
verification, owner-question delivery, proactive memory, and several
coding-agent fixture shapes. It still does not directly grade an interactive
coding failure mode: the user gives an underspecified coding request, the agent
must ask a small number of useful clarifying questions, then use the answers to
make the right change without over-asking or patching against guessed
requirements.

Dialogue SWE-Bench is a current primary-source signal for this gap. It frames
interactive coding as a distinct capability from fully autonomous patching,
uses a persona-grounded user simulator, and reports that better coding models
do not necessarily produce better dialogue behavior. KOTA should not import the
benchmark or add an LLM user simulator. The local response is one compact,
deterministic fixture that makes clarification quality and answer use visible
through artifacts.

## Desired Outcome

Add one shipped eval-harness fixture where the builder receives a small,
ambiguous coding task plus a deterministic scripted user simulator. The correct
solution requires at least one clarifying turn before implementation, and the
final verification checks both the patch and the dialogue path that led to it.

The fixture should make dialogue-driven coding observable:

- The initial tree contains a small broken app or library, local tests, and a
  task whose first user message intentionally omits a material requirement.
- A fixture-owned simulator responds only to a bounded set of relevant
  clarifying questions with persona/requirement facts; irrelevant or repeated
  questions produce deterministic unhelpful responses.
- The agent must ask for the missing requirement before patching, implement
  using the simulator's answer, and write a machine-readable artifact such as
  `dialogue-result.json` containing the transcript, elicited facts, final
  decision, verification command, and evidence that the answer influenced the
  patch.
- Final predicates distinguish a clean dialogue path from lucky autonomous
  patching, unnecessary question loops, ignored answers, and prose-only
  transcript summaries.

## Constraints

- Use the existing eval-harness, session, transcript, predicate, and artifact
  paths. Do not import Dialogue SWE-Bench, SWE-bench tasks, a benchmark runner,
  an LLM judge, or a second dialogue runtime.
- Keep the simulator deterministic and offline. Scripted responses and local
  tests are enough; no live user, network access, external services, or model
  calls from the simulator.
- Bound the dialogue. The fixture should fail excessive or repeated
  clarification loops, while still allowing the one or two turns needed to
  resolve the missing requirement.
- Do not make "ask anything" the target. The fixture must fail an agent that
  asks irrelevant questions or asks after the task is already sufficiently
  specified.
- The scored artifact must include both implementation evidence and dialogue
  evidence. Passing tests without the required elicited fact should fail.
- Keep this out of `pnpm test` unless it is replay-backed. A live-builder
  fixture belongs in `pnpm kota eval run` and cadence, not the standard unit
  test path.

## Done When

- A fixture such as
  `src/modules/eval-harness/fixtures/builder-dialogue-driven-coding/` exists
  with `fixture.json`, `notes.md`, and a minimal `initial/` tree.
- The fixture's initial task is in `data/tasks/ready/`, is valid under task
  validation, and describes the dialogue-driven coding outcome and acceptance
  evidence.
- The initial tree includes a deterministic scripted user simulator and a
  small ambiguous coding task whose correct implementation depends on a
  simulator-provided requirement.
- The seeded baseline fails before the builder runs because the implementation
  and required dialogue artifact are absent or insufficient, and
  `preRunExpectations` record those expected failures.
- Final predicates require the task to move to `done/`, the verification
  command to pass, `dialogue-result.json` to contain the bounded transcript and
  elicited facts, and the patch to reflect the simulator answer rather than a
  hardcoded guess.
- Negative cases are covered by fixture calibration or focused tests:
  autonomous patch without asking fails, irrelevant/repeated questioning fails,
  and an answer-ignoring patch fails.
- `pnpm kota eval list` loads the fixture without provenance or schema errors.
- `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` completes with
  dialogue and implementation predicates passing.

## Product / Safety Link

KOTA's operator-facing coding path is interactive: CLI sessions, chat clients,
owner questions, and daemon-backed sessions all depend on asking the right
question at the right time. A fixture that grades useful clarification reduces
wrong patches from guessed requirements and also guards against over-asking
loops that waste operator attention during Product and Safety work.

## Source / Intent

Explorer run `2026-06-20T20-54-53-314Z-explorer-lj33g9` reviewed an empty
actionable queue. The surfaced strategic blocked alternatives all require
operator-captured evidence and were not movable:

- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`

External source checked:

- `https://arxiv.org/abs/2606.13995` introduces Dialogue SWE-Bench, submitted
  June 12, 2026. Its KOTA-relevant signal is that dialogue-driven coding agents
  should be evaluated on resolving software tasks through user dialogue, with
  dialogue quality treated as a distinct capability from autonomous patching.

Local overlap check:

- Existing owner-question and `askOwnerSteps` work proves operator escalation
  transport and restart-safe waiting, not whether a coding agent asks useful
  clarifying questions inside a task.
- `task-add-proactive-cross-session-intent-resolution-eval` covers hidden
  prior intent and authorization-safe proactivity, not same-task dialogue before
  implementation.
- Existing builder fixtures cover no-op restraint, scope restraint, product
  canaries, multi-service integration, test writing, scientific reproduction,
  and black-box reconstruction, but none requires a bounded user dialogue to
  elicit missing implementation requirements.
- Run-configuration fingerprinting and trajectory diagnostics already cover
  broader benchmark-comparability signals, so this task stays focused on the
  dialogue-specific gap.

The nonduplicative local gap is a compact dialogue-driven coding fixture that
grades when and how the agent asks, whether the answer changes the patch, and
whether the final artifact satisfies the now-specified requirement.

## Initiative

Outcome-grade autonomy evaluation: KOTA should test interactive coding behavior
as an operator-facing capability, not only autonomous patch production.

## Acceptance Evidence

- Diff showing the new fixture directory, including `fixture.json`, `notes.md`,
  the minimal `initial/` project/task files, the deterministic scripted user
  simulator, and the dialogue-result contract.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval list` showing the new fixture loads.
- Transcript captured under `.kota/runs/<run-id>/` for
  `pnpm kota eval run --fixture <new-fixture-id> --repeats 1` showing the
  dialogue and implementation predicates passing.
- Run artifact from the same eval execution showing predicate details,
  `dialogue-result.json`, bounded transcript turns, elicited facts, final
  verification output, and any objective metric values.
- Evidence of temporary negative cases for no-ask patching, irrelevant/repeated
  questioning, and answer-ignoring patching failing the fixture, with those
  regressions reverted before staging.
