---
id: task-ship-research-retry-agent-call-replay-fixture-and-
title: Ship research-retry-agent-call-replay fixture and ride pnpm test smoke gate
status: ready
priority: p2
area: autonomy
summary: Record an agent-call fixture for the research-retry workflow and add it to replay-smoke.test.ts so its unique plumbing (candidates selection, runtime-detect, blocked-task precondition) fails loudly when workflow-layer regressions ship.
created_at: 2026-04-25T00:17:27.112Z
updated_at: 2026-04-25T00:17:27.112Z
---

## Problem

Five shipped replay fixtures are now gated in `pnpm test` via
`src/modules/eval-harness/replay-smoke.test.ts`
(decomposer / improver / explorer / inbox-sorter + builder cadence-only),
and each one was chosen to cover a distinct workflow-layer branch the
others miss. The `research-retry` workflow is the one remaining
agent-bearing autonomy workflow whose runtime plumbing is not replayed
at `pnpm test` time. Its unique surfaces — `candidates.ts` (oldest
blocked-task with a `## Resources` section), `precondition.ts`
(`autonomy.queue.available` trigger gating), `runtime-detect.ts`
(Playwright install + `storageStatePath` probe), and the workflow's
repair checks — can regress silently today and only surface in a live
research-retry run that pays a real vendor bill and re-touches the same
blocked research task with no honest change. That is exactly the shape
`replay-smoke.test.ts` was introduced to prevent.

The one remaining agent-bearing autonomy workflow without a replay
fixture is `pr-reviewer`. It is intentionally out of scope here — its
external-context needs are different (needs a real PR payload), and
punting it keeps this task narrow.

## Desired Outcome

`research-retry-agent-call-replay` ships under
`src/modules/eval-harness/fixtures/` with a real-failure provenance
(source run id from a recent `.kota/runs/` research-retry run), a
recorded `review-research` agent-call, and whatever `runtime-detect`
or `candidates` seed state the workflow needs to route end-to-end in
the subprocess executor. The fixture is added to `SMOKE_FIXTURE_IDS` in
`replay-smoke.test.ts` with a short rationale explaining which branch
the other four smoke fixtures do not cover (at minimum: the
`autonomy.queue.available` trigger path, the candidate-selection call,
and the `runtime-detect` guard). `pnpm test` passes locally.

## Constraints

- Use the standard authoring path: `pnpm kota eval record-agent-step`
  against a real research-retry run. Do not hand-craft the recording.
- Seed `runtime-detect` so the workflow progresses past the browser-
  readiness probe in a hermetic tmpdir. The fixture must not require
  Playwright or network access to replay.
- Keep provenance honest: `sourceRunId` must match a real research-retry
  run's id, per the harness fixture-provenance rule.
- Extend `SMOKE_FIXTURE_IDS` in the same commit so the coverage gap
  closes atomically, and keep the existing four rationales intact.
- `pr-reviewer` stays out of scope; spawn a separate task if that
  workflow also needs smoke coverage.

## Done When

- `src/modules/eval-harness/fixtures/research-retry-agent-call-replay/`
  exists with `fixture.json`, `recordings/<id>.json`, `notes.md`, and a
  seeded `initial/` tree covering candidates + runtime-detect state.
- `replay-smoke.test.ts` references the new fixture in
  `SMOKE_FIXTURE_IDS` with a rationale that names the workflow-layer
  branch it covers.
- `pnpm test` passes locally; the smoke replay produces a `pass` outcome
  for the new fixture and the four existing entries continue to pass.

## Source / Intent

The last five explorer → builder cycles shipped replay-smoke coverage
for decomposer, improver, explorer, inbox-sorter, and builder, each
with an explicit branch-coverage rationale. Closing out the
research-retry gap keeps that regression guarantee honest across every
agent-bearing autonomy workflow for which a fixture can be authored
hermetically, before we layer new autonomy surfaces on top of it.

## Initiative

Replay-smoke coverage: every agent-bearing autonomy workflow that can
be replayed hermetically should fail loudly in `pnpm test` when its
workflow-runtime plumbing regresses, so no regression requires paying a
live LLM bill to surface.

## Acceptance Evidence

- Local `pnpm test` transcript excerpt showing
  `research-retry-agent-call-replay` in the smoke gate's output and
  passing.
- The new fixture directory checked in and referenced from
  `replay-smoke.test.ts`.
- Commit message linking the fixture's `sourceRunId` to a real
  `.kota/runs/<run-id>-research-retry-*/` artifact under
  `research-retry` provenance.
