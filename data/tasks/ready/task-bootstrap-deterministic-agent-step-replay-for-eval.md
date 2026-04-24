---
id: task-bootstrap-deterministic-agent-step-replay-for-eval
title: Bootstrap deterministic agent-step replay for eval-harness agent-call paths
status: ready
priority: p1
area: modules
summary: Add a recorded-response agent-step fake at the harness subprocess boundary so autonomy fixtures can regression-gate agent-call paths (decomposer, builder, critic) without paying real LLM token costs per replay.
created_at: 2026-04-24T15:31:35.687Z
updated_at: 2026-04-24T15:31:35.687Z
---

## Problem

The eval-harness subprocess executor runs real workflows end-to-end via
`kota workflow exec`. For decision-gate branches that short-circuit before
any agent call (e.g. the `decomposer-short-circuits-on-non-timeout` smoke
fixture) that is deterministic and free. For any branch that actually
invokes an agent step — decomposer's `decompose` step on a
timeout-shaped builder failure, every builder run, critic review,
improver analysis — replay would hit the real agent harness and cost a
live LLM run per fixture × repeat. `src/modules/eval-harness/fixtures/uncovered/notes.md`
names this gap explicitly:

> Until the eval harness grows an agent-step fake, a decomposer
> agent-call fixture would dominate eval-set cost. A dedicated follow-up
> task should scope the agent-step bootstrap separately.

The same blocker sits behind every future real-failure fixture that
exercises builder/critic/improver — the workflows the harness exists to
regression-gate most. Without a deterministic replay path, fixture
coverage of agent-call branches stays zero and the harness only catches
plumbing regressions, not agent-behavior regressions.

## Desired Outcome

The eval-harness can replay agent-step–driven workflow branches
deterministically from recorded fixtures, with no live LLM call per
replay. Concretely:

- A fixture can declare a recorded agent-step response (tool-call
  sequence + final text + cost/usage envelope + any emitted artifacts
  the workflow reads afterwards) keyed by workflow name and step id.
- The subprocess executor wires a typed environment contract (env var,
  config file at a known fixture path, or similar strict surface) that
  tells the agent-harness layer inside the child process to load those
  recordings instead of invoking the real adapter.
- The replay path is visible at the `AgentHarness` registry boundary:
  there is one "replay" harness adapter, selected by the same env/config
  seam that the subprocess executor already uses to remap `HOME` and
  `KOTA_PROJECT_DIR`. Production code paths are unchanged; only fixture
  runs opt in.
- Recordings come from real past `.kota/runs/<id>/steps/<step>/` artifacts
  so they stay honest real-failure evidence rather than hand-authored
  mock output. A recorder CLI or fixture-scaffold path extracts a
  recording from a chosen source run directory.
- At least one real-failure fixture that exercises an agent-call branch
  lands as the first consumer — the decomposer `shouldDecompose: true`
  path seeded from `.kota/runs/2026-04-18T15-45-49-339Z-decomposer-zloyo6/`
  is the target called out in the uncovered notes.
- The uncovered-notes entry for decomposer's agent-call path retires to
  the fixture list; remaining uncovered entries (improver, research-retry)
  update to reflect whether this bootstrap closes their blocker or not.

## Constraints

- No test-only production flags, hooks, or override parameters inside
  the core agent-step runtime. The replay seam is an `AgentHarness`
  adapter selected via the normal harness registry, not a parallel path
  hidden behind a boolean in core.
- Recordings must be provenance-pinned to a source run id the same way
  fixture `initial/` trees are — the loader rejects an agent-call
  fixture whose recording cannot name its source run or a
  `smoke-fixture` justification.
- No cost signals leak into agent-facing context. Recorded usage
  envelopes are evaluator-visible only; they do not re-enter any
  subsequent agent-step prompt on replay.
- Fixture working dirs still materialize under the OS tmpdir with `HOME`
  and `KOTA_PROJECT_DIR` remapped. Recordings travel with the fixture
  under `src/modules/eval-harness/fixtures/<name>/` — not in a sibling
  directory and not in `.kota/`.
- Keep the replay adapter under the `eval-harness` module. Do not add a
  parallel fixture-scoped mock layer inside `src/core/agent-harness/`.
- Do not regress existing smoke fixtures — they still short-circuit
  without touching the replay adapter.
- Keep the recorder path small. One CLI entry that reads an existing
  `.kota/runs/<id>/` and writes a recording file is enough; no new
  orchestration layer.

## Done When

- The `AgentHarness` registry includes a replay adapter owned by the
  `eval-harness` module, selected automatically inside fixture
  subprocesses via the existing `HOME`/`KOTA_PROJECT_DIR` remap seam.
- A recorder CLI (e.g. `pnpm kota eval-harness record-agent-step
  <run-id> --step <step-id>`) writes a recording into the fixture's
  directory.
- At least one real-failure fixture with `provenance.kind =
  "real-failure"` exercises an agent-call branch end-to-end and passes
  under `pnpm kota eval-harness run --fixture <name>` without any
  network call or credential read, with evidence captured in the run
  artifact.
- The loader rejects an agent-call fixture whose recording is missing
  or whose `provenance.sourceRunId` does not match the recording's
  source.
- `src/modules/eval-harness/fixtures/uncovered/notes.md` retires the
  decomposer agent-call entry and updates improver/research-retry
  entries to reflect the new state.
- `src/modules/eval-harness/AGENTS.md` documents the recorded-agent-step
  replay surface in one short section (what the adapter is, where
  recordings live, what provenance they carry) — no duplicated runbook.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm kota
  workflow validate` pass.
