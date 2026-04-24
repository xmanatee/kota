---
id: task-seed-inbox-sorter-agent-call-replay-fixture-to-gat
title: Seed inbox-sorter agent-call replay fixture to gate workflow-layer substrate cheaply
status: ready
priority: p1
area: modules
summary: Apply the explorer/builder/decomposer/improver agent-call-replay pattern to inbox-sorter: one replay fixture covering the sort-inbox agent step end-to-end, authored entirely through pnpm kota eval record-agent-step, so the workflow-layer substrate (four repair checks, commit step, inspect-inbox/sort-inbox gating) is gated on every pnpm test without paying for a live LLM.
created_at: 2026-04-24T23:42:47.142Z
updated_at: 2026-04-24T23:42:47.142Z
---

## Problem

The decomposer, builder, improver, and explorer workflows now each have a
recorded-agent-step replay fixture (`decomposer-agent-call-replay`,
`builder-agent-call-replay`, `improver-agent-call-replay`,
`explorer-agent-call-replay`), and three of the four ride the default
`pnpm test` smoke gate in `src/modules/eval-harness/replay-smoke.test.ts`,
so workflow-layer regressions on those four agent workflows surface in CI
instead of only during the weekly eval-harness cadence.

Inbox-sorter is the next obvious uncovered peer. It fires on
`autonomy.inbox.available` whenever an inbox capture lands, runs an agent
step (`sort-inbox`) with four repair checks (`task-queue-valid` with
`--min-ready 0`, `no-scratch-artifacts`, `commit-message-exists`,
`commit-stageable`), an `inspect-inbox` code step that gates the agent
step on `needsAttention`, and a terminal `commit` step. Its only current
harness coverage is two live-LLM fixtures (`inbox-sorter-smoke` proves the
end-to-end normalize-one-idea path; `inbox-sorter-dedup-against-open-tasks`
encodes the dedup-against-existing-tasks decision from source run
`2026-04-15T21-20-03-042Z-inbox-sorter-j7lclg`). Both pay for a real agent
call on every eval-set run and gate generator-quality decisions, not the
workflow-layer plumbing. A workflow-layer regression in any of the four
repair checks, the `inspect-inbox` `needsAttention` predicate, the agent
step's writeScope plumbing, or the inbox-sorter commit step can ship today
and only surface once the weekly cadence run fires — the same failure
mode the existing replay fixtures exist to close on the other workflows.

The recorder auto-extraction work
(`task-auto-extract-bash-and-edit-mutations-in-the-eval-h`,
`task-auto-extract-judge-call-recordings-in-the-eval-har`) plus the
replay adapter (`src/modules/eval-harness/replay-harness.ts`,
`recorder.ts`) already support everything this fixture needs:
`pnpm kota eval record-agent-step` auto-extracts the
`data/inbox/<file>.md` deletion, the `data/tasks/ready/task-*.md` (or
backlog/dropped, depending on source run) creation, the run-directory
`commit-message.txt` emission, and the `sort-inbox` step's response
envelope from a chosen source run.

## Desired Outcome

One new fixture directory
`src/modules/eval-harness/fixtures/inbox-sorter-agent-call-replay/`
seeded entirely through the recorder CLI from a real past inbox-sorter
run (e.g. `2026-04-24T22-53-55-335Z-inbox-sorter-1u1xc9` — the run that
committed `241b3382` "Graduate broken decomposer-replay-fixture inbox
note into a p1 ready task" — or a comparable recent success), containing:

- `fixture.json` declaring the inbox-sorter workflow, triggering
  `autonomy.inbox.available` with the source-run's `inboxCount` payload,
  forwarding a fixed `_runId` so predicates can inspect
  `.kota/runs/<id>/metadata.json` deterministically, and asserting via
  the existing predicate contract that the `sort-inbox` step,
  `commit` step, and the four repair checks all succeed, the inbox file
  is drained, and the new normalized task lands in `data/tasks/`.
- `initial/` tree recording the pre-run inbox capture (the source-run's
  `data/inbox/<file>.md`), an empty `data/tasks/` tree (or a seeded
  baseline that matches the source run's pre-run state), and the
  `package.json` / `dist/` / `.gitignore` / `validate-tasks` scaffolding
  shape established by the existing replay fixtures.
- `recordings/sort-inbox.json` recording authored end-to-end by the
  recorder — no hand-authored agent-call entries, per the
  improver/explorer-replay precedent.
- `notes.md` naming the source run id and stating the workflow-layer
  surfaces this fixture gates (four repair checks, inspect-inbox
  `needsAttention` gating, commit step) vs what the existing live
  fixtures (`inbox-sorter-smoke`, `inbox-sorter-dedup-against-open-tasks`)
  still cover (real-LLM normalize-one-idea path and dedup-against-
  existing-tasks decision).

The fixture is wired into the `pnpm test` smoke gate by adding it to the
`SMOKE_FIXTURE_IDS` list in
`src/modules/eval-harness/replay-smoke.test.ts` alongside the
decomposer/improver/explorer replays. Add only if the fixture exercises a
workflow-runtime branch the existing three smoke fixtures do not — most
likely the `autonomy.inbox.available` trigger receipt path and the
inspect-inbox/sort-inbox `needsAttention` gating shape, which none of
the other shipped replays exercise; otherwise leave it on cadence-only
coverage and document the rationale in `notes.md`.

The `uncovered/notes.md` entry need not change unless the work uncovers
a new retirement reason; this task does not remove any retirement entry.

## Constraints

- Reuse the existing recorder (`pnpm kota eval record-agent-step`) and
  replay adapter. Do not introduce a parallel recording format, new
  predicate kind, or second replay harness.
- The fixture must load cleanly under `loadAllFixtures` and pass under
  `pnpm kota eval run -- --fixture inbox-sorter-agent-call-replay`. No
  hand-authored `sort-inbox.json` entries: the recorder must produce
  every recorded field.
- Source-run selection: pick a recent successful inbox-sorter run whose
  outcome already satisfies the predicates this fixture asserts (one
  inbox file drained, at least one normalized task file landed, commit
  step succeeded, no repair iterations or only repair iterations whose
  recovery is itself in the recorded mutation set). Do not edit the
  source run's artifacts to fit the fixture; fit the predicates to the
  source run's reality.
- The fixture must not depend on network access, real `gh`/`git remote`
  calls, or the browser module. The replay adapter already handles the
  agent-step boundary; the surrounding workflow steps are in-process
  code that run against the fixture working dir.
- Do not silently drop the existing `inbox-sorter-smoke` or
  `inbox-sorter-dedup-against-open-tasks` live fixtures — the replay
  fixture covers complementary surfaces (workflow-layer plumbing) and
  all three should stay.
- The replay adapter records the agent step's response envelope and
  resolved file mutations. If the source run's `sort-inbox` agent
  decision was "drop the inbox capture without scaffolding a task"
  (a valid sorter outcome), the recorded mutations are a single inbox
  deletion plus the run-directory `commit-message.txt`; pick a source
  run whose outcome matches the predicates this fixture is meant to
  gate, rather than narrowing the predicates to fit a degenerate run.

## Done When

- `src/modules/eval-harness/fixtures/inbox-sorter-agent-call-replay/`
  exists with `fixture.json`, `initial/`, a recorder-authored
  `sort-inbox.json`, and `notes.md` naming the source run.
- `pnpm kota eval run -- --fixture inbox-sorter-agent-call-replay`
  passes.
- The replay fixture is included in the `pnpm test` smoke gate
  alongside the decomposer/improver/explorer replays (or the rationale
  for cadence-only coverage is documented in `notes.md` if the fixture
  does not exercise a unique workflow-runtime branch); running
  `pnpm test` exercises at least one workflow-layer assertion from the
  inbox-sorter replay fixture in the gated case.
- A documentation pass in the fixture's `notes.md` explains which
  workflow-layer paths this fixture regression-gates (four repair
  checks, inspect-inbox `needsAttention` gating, commit step) and
  which real-LLM failure modes it intentionally leaves to
  `inbox-sorter-smoke` and `inbox-sorter-dedup-against-open-tasks`.

## Source / Intent

Direct extension of the recent eval-harness replay-fixture initiative:
`task-seed-builder-agent-call-replay-fixture-to-regressi`,
`task-seed-improver-agent-call-replay-fixture-using-reco`,
`task-fix-broken-decomposer-agent-call-replay-fixture-so`, and
`task-seed-explorer-agent-call-replay-fixture-to-regress` established the
pattern. Inbox-sorter fires on every operator capture and processes them
into normalized tasks; workflow-layer regressions in its four repair
checks, the inspect-inbox `needsAttention` gating, or the commit step
today only surface during the weekly eval-harness cadence run (the two
existing inbox-sorter fixtures gate generator-quality decisions, not the
workflow-layer plumbing). This task closes the coverage gap with the
cheapest tool already in the codebase.

## Initiative

Eval-harness regression-gate coverage: every recurring autonomy
workflow whose workflow-layer substrate can regress silently (repair
checks, commit step, per-workflow bookkeeping) should have a
recorded-agent-step replay fixture gated in `pnpm test`, so a
workflow-layer regression blocks commits immediately instead of
surviving until the weekly cadence.

## Acceptance Evidence

- `pnpm kota eval run -- --fixture inbox-sorter-agent-call-replay`
  transcript showing the fixture loads, replays the recorded
  `sort-inbox` step, and passes every declared predicate.
- `pnpm test` transcript showing the new fixture is exercised by the
  smoke gate (or, if the fixture stays on cadence-only coverage, the
  `notes.md` rationale for that decision).
- `src/modules/eval-harness/fixtures/inbox-sorter-agent-call-replay/notes.md`
  naming the source run id, the workflow-layer surfaces gated, and
  the explicit division of labor vs `inbox-sorter-smoke` and
  `inbox-sorter-dedup-against-open-tasks`.

## Plan

- Pick a recent successful inbox-sorter run whose outcome satisfies the
  predicates the fixture will assert (one inbox file drained, at least
  one normalized task file landed in `data/tasks/`, commit step
  succeeded, repair iterations match the recorded mutation set).
  `2026-04-24T22-53-55-335Z-inbox-sorter-1u1xc9` (commit `241b3382`,
  one inbox capture in / one ready task out, no repair iterations) is
  a strong candidate; reverify before recording.
- Author the fixture through `pnpm kota eval record-agent-step` using
  that source run; let the recorder produce every recorded entry and
  `initial/` tree contents.
- Decide whether the fixture exercises a workflow-runtime branch the
  existing three smoke fixtures do not (most likely the
  `autonomy.inbox.available` trigger receipt path and the
  inspect-inbox/sort-inbox `needsAttention` gating). If yes, wire it
  into `replay-smoke.test.ts`; if no, document the cadence-only choice
  in `notes.md`.
