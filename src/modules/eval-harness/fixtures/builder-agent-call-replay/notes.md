# builder-agent-call-replay fixture

End-to-end replay of builder's `build` agent step through the eval-harness
replay adapter, including the critic-review judge call that every builder run
invokes. The fixture regression-gates target-task inspection, builder harness
preflight, the build step, the configured package/task/boundary/hygiene repair
checks, critic review, and runtime-owned integration and publication through
the same subprocess executor path used in production, without invoking a real
LLM.

## Shape

- `initial/` seeds one open task (`task-add-decomposer-
  shoulddecompose-false-smoke-fixture`) plus the minimal repo scaffolding
  builder needs: a stub `package.json` whose script entries satisfy builder's
  repair-loop shell-outs, a stub `dist/cli.js` for
  `node dist/cli.js workflow validate`, and the pre-edit state of
  `src/modules/eval-harness/fixtures/uncovered/notes.md` (the file the source
  run edited).
- `recordings/build.json` carries the builder agent's source response envelope
  and the current file operations needed to reproduce the post-agent repo
  state: the task move from `data/tasks/` to the done archive, the four new files under
  `src/modules/eval-harness/fixtures/decomposer-short-circuits-on-non-timeout/`,
  the edited `fixtures/uncovered/notes.md`, and the run-directory
  `commit-message.txt` artifact.
- `recordings/critic-review.json` carries the source critic verdict JSON
  (`{"verdict":"pass", ...}`). The replay adapter recognizes critic prompts
  by the `## Task (what was asked)` header and routes them to this recording.
- `{{runDir}}` inside a recorded path is substituted with the current fixture
  run directory at replay time so the recording is portable across subprocess
  runs.

## Why this shape

The source run exercises builder's agent-call and critic plumbing with a real
task transition and a nontrivial mutation set. Replaying both calls keeps the
workflow/runtime contract covered without turning the fixture into a generator
quality test:

- trigger payload and task-contract data reach target inspection and the
  builder harness preflight;
- the build step's write scope and mutation attribution consume the replayed
  operations exactly as they consume live agent writes;
- every configured code repair check runs, while the fixture's package scripts
  keep project-specific shell-outs deterministic;
- critic review uses the same registered judge path as a live build;
- runtime stages and integrates the replayed mutation set through its normal
  publication path.

Runtime-owned evidence remains separate from agent-authored run-directory
files. Evaluator calibration and calibration repair also remain distinct
runtime concepts; they are not replaced by agent-authored success claims. The
current builder agent contract requires only `commit-message.txt`, so no
parallel agent-authored proof files are replayed.

## Complementary fixtures

The live-LLM builder fixtures remain generator-quality probes for specific
failure shapes that replay cannot cover. This fixture pins workflow and runtime
plumbing; live fixtures assess whether the agent still solves their seeded
tasks.

## Recorder extraction

Both recordings originate from `pnpm kota eval record-agent-step`, one
invocation per agent call:

- `pnpm kota eval record-agent-step --run-id <id> --step build
  --fixture builder-agent-call-replay` writes `recordings/build.json`. The
  recorder resolves the source commit from `steps/commit.json` and walks its
  diff, so repo-tree operations come from `git show <sha>:<path>`. The curated
  recording retains `commit-message.txt`, the sole current agent-authored
  run-directory artifact.
- `pnpm kota eval record-agent-step --run-id <id> --judge
  critic-review --fixture builder-agent-call-replay` writes
  `recordings/critic-review.json`. Judge mode reads the source run's normalized
  critic verdict and wraps it as `response.text`; judge recordings have no file
  operations because judges have no tool access.

The fixture's `initial/` tree is authored separately from the source commit's
pre-commit parent so replay starts from the repository state the builder saw.
