---
id: task-retire-stale-research-retry-uncovered-fixtur
title: Retire stale research-retry uncovered-fixture note
status: done
priority: p2
area: autonomy
summary: Align eval-harness uncovered workflow notes with the shipped research-retry replay fixture so coverage records no longer claim a gap that is already smoke-gated.
created_at: 2026-05-18T05:31:48Z
updated_at: 2026-05-18T05:37:00.107Z
---

## Problem

`src/modules/eval-harness/fixtures/research-retry-agent-call-replay/`
exists, and `src/modules/eval-harness/replay-smoke.test.ts` includes it
in `SMOKE_FIXTURE_IDS` with a rationale for the research-retry-specific
branches it covers. The coverage ledger at
`src/modules/eval-harness/fixtures/uncovered/notes.md` still says
research-retry is retired because replay cannot cover its browser-tool
side effects without a browser fake or module-loader stub.

That note is now stale. The shipped fixture intentionally uses a hermetic
plain-http blocker to cover the workflow-layer substrate
(`inspect-candidates`, `precondition`, `mark-attempt`, repair checks, and
commit) while leaving live authenticated browser source reading to the
blocked research tasks. Leaving the old retired entry in place makes
operators and future explorers believe an eval-harness gap remains after the
smoke gate already covers the replayable part.

## Desired Outcome

The eval-harness coverage records consistently describe research-retry:

- `uncovered/notes.md` no longer claims research-retry lacks replay coverage.
- The note distinguishes the covered workflow-layer replay from any still-live
  browser-auth/source-access limitations that belong to
  `task-enable-autonomous-access-to-auth-walled-sources-so` and the blocked
  research tasks, not to eval-harness replay coverage.
- If an existing focused test can cheaply prevent the same drift, it is added
  near the eval-harness fixture or smoke-gate tests. If that would become a
  brittle prose-catalog test, keep the change to the stale coverage record
  and do not add a guard.

## Constraints

- Do not weaken or remove `research-retry-agent-call-replay`; it is already a
  smoke-gated fixture.
- Do not add a browser fake, Playwright dependency, authenticated profile
  fixture, or networked source-reading path for this task. Those are separate
  source-access concerns and are still blocked on operator capability.
- Do not turn durable docs into a fixture inventory. Keep the update scoped to
  the existing uncovered-coverage ledger and any focused regression test that
  naturally belongs beside it.
- Preserve the replay-smoke rationale unless the implementation discovers it
  is inaccurate.

## Done When

- `src/modules/eval-harness/fixtures/uncovered/notes.md` accurately reflects
  that research-retry's replayable workflow-layer path is covered by
  `research-retry-agent-call-replay`.
- Any remaining limitation in the note is scoped to live authenticated-browser
  source access, not to missing eval-harness replay substrate.
- A focused eval-harness test is added only if it can assert this invariant
  from fixture metadata or smoke-gate membership without parsing broad prose.
- `pnpm run validate-tasks` passes.
- The relevant eval-harness focused tests pass, or the builder records why no
  test was necessary for a notes-only correction.

## Source / Intent

Explorer run `2026-05-18T05-28-31-787Z-explorer-8rgfw1` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` were all operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Retire stale research-retry uncovered-fixture note" --state ready --area autonomy --priority p2 --summary "Align eval-harness uncovered workflow notes with the shipped research-retry replay fixture so coverage records no longer claim a gap that is already smoke-gated."
```

It failed before writing a file because the workflow sandbox returned
`Fatal: fetch failed`, so this task follows the normalized schema manually.

Local inspection found the inconsistency:

- `src/modules/eval-harness/fixtures/research-retry-agent-call-replay/fixture.json`
  declares a real-failure replay fixture for workflow `research-retry`.
- `src/modules/eval-harness/replay-smoke.test.ts` includes
  `research-retry-agent-call-replay` in `SMOKE_FIXTURE_IDS`.
- `src/modules/eval-harness/fixtures/research-retry-agent-call-replay/notes.md`
  explains why the fixture uses a synthetic plain-http blocker under a
  hermetic no-Playwright/no-profile profile.
- `src/modules/eval-harness/fixtures/uncovered/notes.md` still says
  research-retry is retired because replay cannot cover it.

## Initiative

Eval-harness coverage honesty: coverage ledgers should match the fixture set
that actually runs, so explorers and operators do not open duplicate work or
miss the boundary between replayable workflow plumbing and genuinely blocked
external capability.

## Acceptance Evidence

- Diff of `src/modules/eval-harness/fixtures/uncovered/notes.md` showing the
  stale research-retry retired entry corrected or removed.
- Test output for the focused eval-harness file(s) touched, or a short
  implementation note explaining why a prose-only ledger correction did not
  warrant a brittle test.
- `pnpm run validate-tasks` output showing the queue remains valid.
