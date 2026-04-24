---
id: task-fix-broken-decomposer-agent-call-replay-fixture-so
title: Fix broken decomposer-agent-call-replay fixture so cadence pass^k stops degrading
status: ready
priority: p1
area: modules
summary: Recorded decompose.json subtasks predate the open-task quality gates and now fail task validation, so the cadence run reports fail/error every week and pass^k drags on each evaluation.
created_at: 2026-04-24T22:54:54.232Z
updated_at: 2026-04-24T22:54:54.232Z
---

## Problem

`src/modules/eval-harness/fixtures/decomposer-agent-call-replay/recordings/decompose.json`
records two new ready-queue subtasks
(`task-fixture-replay-subtask-external-project-e2e.md`,
`task-fixture-replay-subtask-workflow-precedence.md`) that were
validation-passing when the recording was captured but predate the
open-task quality gates that now require `## Source / Intent`,
`## Acceptance Evidence`, and `## Initiative` sections on every open
task at `p0`/`p1`/`p2`.

Result: `pnpm kota eval run --fixture decomposer-agent-call-replay`
exits with status 1 — the `task-queue-valid` repair check fails after
the agent step, the workflow tries to repair, and the replay adapter
has no recording for the repair-attempt prompt shape. The weekly
`eval-harness-cadence` workflow scores the fixture as fail/error every
run, dragging `pass^k` down on every cadence evaluation. The fixture
is one of the three load-bearing replay fixtures the eval-harness
initiative shipped to gate workflow-layer regressions, and the smoke
gate that just landed in `pnpm test` (commit `c99b6533`) cannot
include this fixture until it is green again.

## Desired Outcome

`pnpm kota eval run --fixture decomposer-agent-call-replay` exits 0,
the cadence run scores the fixture green, and the fixture is eligible
to join the `pnpm test` smoke gate alongside builder + improver. The
recorded subtasks satisfy current task validation
(`Source / Intent`, `Acceptance Evidence`, `Initiative` present and
substantive) without diluting what the fixture is regression-gating —
the trigger payload round-trip, `assess-failure` decision, the
`decompose` agent step, all four decomposer repair-loop checks, the
commit step, and the restart request.

## Constraints

- Pick one of the two routes called out in the inbox capture: either
  re-record `decompose.json` against a fresh real decomposer run whose
  produced subtasks pass current task-validation rules, or patch the
  recorded subtask bodies in place to add the missing required
  sections while leaving the rest of the recording (envelope, file
  ops, `commit-message.txt`, `notes.md`) intact. Re-recording is the
  cleaner long-term path because it lets the fixture provenance line
  follow `pnpm kota eval record-agent-step` automation; in-place
  patching is acceptable if no real committing decomposer run is
  available, and `notes.md` already documents that fallback.
- Keep the predicate set unchanged unless the new recording forces a
  rename — the fixture's regression-gating shape (file-absent on
  `doing/`, file-exists in `dropped/`, `## Decomposed` section, two
  ready-queue subtasks, agent + commit step success in
  `metadata.json`, `committed: true`) is load-bearing.
- If patching in place, preserve the recording's source-run provenance
  line in `notes.md` and update the file's commentary to explain why
  the subtask bodies diverge from a verbatim source-run snapshot.
- Do not weaken the open-task quality gates to make the fixture pass.
  The validator is the contract; the fixture has to satisfy it like
  any other task.
- After the fixture is green, add it to the `pnpm test` replay-smoke
  gate landed in commit `c99b6533` so the same regression cannot
  return silently. The smoke gate currently runs improver only;
  decomposer is the smallest `initial/` of the three and was the
  intended primary gate per the parent task's plan.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and
  `pnpm kota workflow validate` all pass.

## Done When

- `pnpm kota eval run --fixture decomposer-agent-call-replay` exits 0
  with all predicates passing, captured under `.kota/runs/<run-id>/`.
- The two recorded ready-queue subtasks pass `pnpm kota task validate`
  (or whatever the equivalent validator entry point is) standalone, so
  any future task-format change that affects them surfaces immediately.
- The decomposer fixture is wired into the existing replay-smoke test
  in `src/modules/eval-harness/` so `pnpm test` runs it end-to-end via
  the subprocess executor; an intentional regression (e.g. removing
  the replay adapter registration) causes the new gate to fail.
- `notes.md` for the fixture is updated to reflect whichever fix path
  was taken (fresh recording with new source-run id, or in-place
  patched recording with explanation).
- All standard checks pass.

## Source / Intent

Captured in `data/inbox/note-broken-decomposer-replay-fixture.md`,
written during run `2026-04-24T22-33-19-581Z-builder-ezj3rl` while
landing the smoke gate (`task-gate-shipped-replay-fixtures-from-pnpm-
test-so-wor`, commit `c99b6533`). Intentionally left out of that
task's scope (the task said "If one fixture is enough, ship one" and
improver covered the load-bearing surfaces and judge-prompt routing).
Filed because the cadence `pass^k` drag is invisible otherwise: every
weekly run reports a fail/error against this fixture and that signal
should not be normalized.

## Initiative

Eval-harness as a real autonomy regression gate. The initiative
shipped recorder auto-extraction, three replay fixtures, and a
`pnpm test` smoke gate; one of the three replay fixtures being broken
silently undermines the gate the rest of the initiative built. Closing
this puts decomposer back on the same regression footing as builder
and improver.

## Acceptance Evidence

- Transcript of `pnpm kota eval run --fixture decomposer-agent-call-replay`
  exiting 0 with predicate-by-predicate pass output, captured under
  `.kota/runs/<run-id>/`.
- Diff of `recordings/decompose.json` (or the new recording plus old
  removal) plus the `notes.md` update.
- Diff of the `pnpm test` smoke-gate test file showing decomposer
  added to the gated fixture set, plus a `pnpm test` transcript before
  and after.
- Transcript of an intentional regression (e.g. revert the recording
  fix, or remove the replay adapter registration) showing both the
  cadence CLI run and the new smoke-gate test failing, captured under
  `.kota/runs/<run-id>/` and reverted before commit.
