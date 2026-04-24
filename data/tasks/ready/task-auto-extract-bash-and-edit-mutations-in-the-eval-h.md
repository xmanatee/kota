---
id: task-auto-extract-bash-and-edit-mutations-in-the-eval-h
title: Auto-extract Bash and Edit mutations in the eval-harness recorder
status: ready
priority: p1
area: modules
summary: Extend src/modules/eval-harness/recorder.ts so pnpm kota eval record-agent-step produces a complete file-operations list without hand-authored entries for pnpm kota task move/create, Edit-tool edits, or git mv — reading the source run's committed diff as ground truth.
created_at: 2026-04-24T20:34:20.748Z
updated_at: 2026-04-24T20:34:20.748Z
---

## Problem

The recorded agent-step replay adapter (commit `241491bd`) ships with two consumers today: `fixtures/decomposer-agent-call-replay/` and `fixtures/builder-agent-call-replay/` (commit `ef8431a8`). Both fixtures' `notes.md` document the same recorder gap in the authoring flow: `src/modules/eval-harness/recorder.ts` only extracts `Write` tool events from `<stepId>.events.jsonl`, so every other file mutation the source run actually produced has to be hand-authored.

Concretely, each replay fixture today carries hand-written `fileOperations` entries for:

- `pnpm kota task move <id> <state>` → a `delete` on the old path plus a `write` with the new frontmatter on the new path, transcribed from `git show <commit>^:<oldPath>` and `git show <commit>:<newPath>`.
- `pnpm kota task create …` → a `write` on the new task file, transcribed from `git show <commit>:<newPath>`.
- `git mv` of any file (e.g. task moves via shell rather than the CLI) → the same delete/write pair, transcribed the same way.
- `Edit`-tool edits on any pre-existing file (e.g. the `fixtures/uncovered/notes.md` line flip that every decomposer/builder replay-candidate run currently produces) → a single `write` with the post-edit content, transcribed from `git show <commit>:<path>`.

The builder replay fixture's authoring walk (`src/modules/eval-harness/fixtures/builder-agent-call-replay/notes.md` §Recorder extraction) is explicit that step 3 was "Assemble `recordings/build.json.fileOperations` from the six files the real commit touched … plus the three run-directory artifacts the builder always writes" — i.e. the only file ops the recorder currently auto-filled were the Write-event ones. Every other entry came from manually running `git show <commit>:<path>`.

This bottlenecks future replay fixtures. Seeding coverage for the remaining agent-call autonomy workflows (`research-retry` once the browser-fake capability lands, `improver` once the KOTA-source bootstrap capability lands, `inbox-sorter`, `pr-reviewer` once the fake-`gh` capability lands, any future workflow) and retargeting existing fixtures to newer source runs all pay the same hand-transcription tax per file the commit touched. The fixture-provenance contract already pins every recording to a `sourceRunId`, so there is exactly one canonical answer for "what file mutations did this run produce in the repo tree": the diff of the commit that run produced.

## Desired Outcome

`pnpm kota eval record-agent-step --run-id <id> --step <step> --fixture <id>` produces a complete, honest `fileOperations` list without hand-authored entries for Edit-tool edits, `pnpm kota task move/create` calls, `git mv`, or any other Bash-induced mutation that ended up in the source run's commit. An author adding a new replay fixture from a real past run does the following and nothing more:

1. Runs the CLI once.
2. Writes `fixture.json` with predicates, `initial/` with the pre-run repo state, and `notes.md` with the shape/why.
3. Runs `pnpm kota eval run --fixture <id>` to verify the fixture passes.

Concretely the recorder's source of truth for repo-tree file operations becomes the commit produced by the source run, and the existing Write-event scan is reserved for run-directory artifacts (which the commit does not contain). Specifically:

- The commit step (`src/modules/autonomy/commit.ts` — `commitWorkflowChanges`) records the committed SHA in its step output so the recorder has a direct pointer. Today the step output is `{ committed: true, message: string }`; extend it to `{ committed: true, message: string, sha: string }` and update every caller/type, the step-output typing, and the existing fixtures under `.kota/runs/` tolerated-shape tests. A run with no commit step (explorer no-op, improver gate-skip, decomposer short-circuit) still records `{ committed: false }`.
- The recorder resolves the source run's commit SHA from the run's `steps/commit.json` output. A source run whose commit step did not commit (or did not run) is a hard error from the recorder — such a run has no post-agent file mutations worth replaying, and the CLI should say so plainly rather than emit an empty or partial recording.
- For every path touched by that commit that lives outside the run directory (i.e. not under `.kota/runs/<sourceRunId>/`): the recorder reads the post-commit content via `git show <sha>:<path>` for added/modified files and emits a `write` op; for deleted files it emits a `delete` op; for renamed files (detected via `git diff --find-renames <sha>^ <sha>`) it emits a `delete` on the old path plus a `write` on the new path with the post-rename content.
- Run-directory paths (under `.kota/runs/<sourceRunId>/`) continue to come from the Write-event scan and continue to be templated to `{{runDir}}`. Run-dir artifacts are not committed and the commit diff does not include them, so the two sources are naturally disjoint.
- A file that appears in both the commit diff and the Write-event scan (i.e. the agent wrote a repo-tree file directly with the `Write` tool) resolves to the commit-diff version — the commit is closer to what downstream workflow code will observe than the intermediate Write, because Edits/Bash-moves after the Write would have changed the content.
- Skipped Write events (paths outside the project) remain reported in `ExtractRecordingResult.skippedWritesOutsideProject` the same way they do today.
- `recorder.ts` stays under the file-size budget and keeps one cohesive public entrypoint (`extractAgentStepRecording`). The commit-diff scan is a helper inside this module, not a new public API.

Both existing replay fixtures (`decomposer-agent-call-replay`, `builder-agent-call-replay`) are re-extracted with the new recorder in the same commit as the recorder change, as end-to-end verification that the auto-extracted recording round-trips through `pnpm kota eval run --fixture <id>` deterministically. The hand-transcribed sections of their `notes.md` files are simplified to reflect the new one-shot flow.

## Constraints

- The commit-SHA field added to the commit-step output is the single authoritative source. Do not add a parallel "last commit" tracker elsewhere in the runtime, and do not have the recorder call `git log --grep <message>` as a fallback — that is the kind of permissive coercion `AGENTS.md` forbids. If the commit step did not commit, recording fails loudly with the run id and step id named.
- `commitWorkflowChanges`'s internal implementation already runs `git commit` and has the SHA available immediately via `git rev-parse HEAD`. Capture the SHA in the same function and thread it through the return type; do not push the capture responsibility to step runners.
- Do not introduce a new file-operation kind (`edit`, `rename`, etc.). The existing `write`/`delete` union already expresses every repo-tree outcome the replay adapter needs. A rename is a `delete` + `write`; an Edit is a `write` with the post-edit content.
- Do not change the recording schema version. The on-disk recording format is unchanged; only the recorder's extraction path is richer. Existing recordings continue to load.
- Keep the recorder's input surface (`ExtractRecordingParams`) unchanged: `projectDir`, `sourceRunId`, `stepId`, `fixtureDir`. The recorder discovers the commit SHA itself; the author does not pass it.
- A source run that touched files outside the project root (symlinks, stray absolute paths) is an error — `git show` will not enumerate them either way. The recorder surfaces this as a typed failure naming the offending paths, with the same `skippedWritesOutsideProject` report channel used today. No silent skip.
- The replay adapter (`src/modules/eval-harness/replay-harness.ts`) is NOT modified by this task. Its write/delete operation handling is already correct and the new recordings fit unchanged.
- `KOTA_EVAL_HARNESS_REPLAY_ROOT` env-var seam is unchanged. No new env vars.
- No cost signals in agent-facing context (autonomy rule). Recording `usage`/`totalCostUsd` remains evaluator-visible only.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm kota workflow validate` all pass.

## Done When

- `src/modules/autonomy/commit.ts`:
  - `CommitResult` (the `committed: true` branch) carries the new `sha: string` field.
  - `commitWorkflowChanges` captures the SHA via `git rev-parse HEAD` after the successful `git commit` and returns it.
  - All callers and step-output type declarations are updated; no optional/nullable SHA field.
- `src/modules/eval-harness/recorder.ts`:
  - Replaces the Write-event-only extraction for repo-tree paths with a commit-diff-based extraction that reads the source run's `steps/commit.json` output to resolve the SHA and runs `git show`/`git diff --find-renames` inside `projectDir`.
  - Preserves the Write-event scan for run-directory paths (under `.kota/runs/<sourceRunId>/`) with the existing `{{runDir}}` templating.
  - Fails loudly with a typed error and the run id named when the commit step did not commit or did not run.
  - Continues to report `skippedWritesOutsideProject` for paths outside the project root.
- Both `decomposer-agent-call-replay` and `builder-agent-call-replay` fixtures are re-extracted with the new recorder and their `notes.md` files updated to drop the manual-transcription steps. Resulting `pnpm kota eval run --fixture <id>` runs pass deterministically under both fixtures, captured as per-run artifacts under `.kota/runs/<run-id>/` showing zero live-LLM calls.
- `src/modules/eval-harness/AGENTS.md` "Recorded Agent-Step Replay" section is updated in one short paragraph to reflect that the CLI is now the single source for `fileOperations` from a committing source run, with hand-authored ops reserved for Write-only no-commit branches (e.g. run-dir-only side effects).
- `src/modules/eval-harness/recorder.test.ts` covers: (a) a committing source run round-trips file ops from the commit diff (adds, modifies, renames, deletes), including run-dir Write events templated to `{{runDir}}`; (b) a non-committing source run is rejected with a typed error naming the run id; (c) a source run whose commit touches a path outside the project root is surfaced via `skippedWritesOutsideProject`.
- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm kota workflow validate` all pass.

## Source / Intent

Follow-on to the just-landed builder replay fixture (commit `ef8431a8`, task `task-seed-builder-agent-call-replay-fixture-to-regressi`). That fixture's authoring notes are explicit that the recorder auto-extracted only Write-tool events and every other file mutation was hand-transcribed from `git show <commit>:<path>`. The same gap is documented in the decomposer replay fixture. The fixture-provenance contract already pins every recording to a single `sourceRunId`, so there is exactly one canonical answer for "what file mutations did this run produce" — the run's commit diff — and the recorder should use it. This task closes the bottleneck before a third or fourth replay fixture encodes the same manual transcription tax.

## Initiative

Eval-harness as a real autonomy regression gate: KOTA's autonomy workflows should be covered by fixtures cheap enough to run per autonomy-change, seeded from real past failures, so plumbing regressions in the load-bearing workflows (decomposer, builder, improver, research-retry, …) are caught before they cost a real run. Fixture authoring is on the critical path for coverage growth; automating recorder extraction keeps the marginal cost of a new replay fixture low enough that the harness actually earns its regression-gate role.

## Acceptance Evidence

- Diff of `src/modules/eval-harness/recorder.ts`, `src/modules/eval-harness/recorder.test.ts`, `src/modules/autonomy/commit.ts` (and any step-output typing/test updates), `src/modules/eval-harness/AGENTS.md`, both replay fixture directories (`decomposer-agent-call-replay/recordings/*`, `decomposer-agent-call-replay/notes.md`, `builder-agent-call-replay/recordings/*`, `builder-agent-call-replay/notes.md`) in one commit.
- Transcript of `pnpm kota eval record-agent-step --run-id <id> --step <step> --fixture <id>` producing a complete `recordings/<stepId>.json` for a source run that includes Edit/Bash-induced mutations, captured in the builder run artifact.
- Transcript of `pnpm kota eval run --fixture decomposer-agent-call-replay` and `pnpm kota eval run --fixture builder-agent-call-replay` both passing deterministically with zero live-LLM calls, captured under `.kota/runs/<run-id>/`.
