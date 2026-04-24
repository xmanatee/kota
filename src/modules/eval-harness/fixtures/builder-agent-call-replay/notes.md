# builder-agent-call-replay fixture

End-to-end replay of builder's `build` agent step through the eval-harness
replay adapter, including the phase-2 critic-review judge call that every
builder run invokes. The fixture regression-gates the builder
workflow-layer paths — inspect-ready-queue, build, the full repair loop
(success-criteria, task-queue-valid, commit-message-exists,
commit-stageable, critic-review), create-task-branch, commit,
write-run-summary, write-calibration-artifact, emit-build-committed, and
the restart request — against the same subprocess executor path the
daemon runs in production, without invoking a real LLM.

## Shape

- `initial/` seeds one ready-queue task (`task-add-decomposer-
  shoulddecompose-false-smoke-fixture`) plus the minimal repo scaffolding
  builder needs: a stub `package.json` whose script entries satisfy
  builder's repair-loop shell-outs, a stub `dist/cli.js` for
  `node dist/cli.js workflow validate`, and the pre-edit state of
  `src/modules/eval-harness/fixtures/uncovered/notes.md` (the file the
  real run edited).
- `recordings/build.json` carries the builder agent's real response
  envelope and the full set of file operations that reproduce the
  post-agent repo state the source run produced: the task move from
  `ready/` to `done/`, the four new files under
  `src/modules/eval-harness/fixtures/decomposer-short-circuits-on-non-timeout/`,
  the edited `fixtures/uncovered/notes.md`, and the run-directory
  artifacts (`success-criteria.txt`, `success-criteria-verified.txt`,
  `commit-message.txt`).
- `recordings/critic-review.json` carries the real critic verdict JSON
  the source run produced (`{"verdict":"pass", ...}`). The replay adapter
  recognizes critic prompts by the `## Task (what was asked)` header and
  routes them to this recording — the same fixture-directory seam as the
  step recording.
- `{{runDir}}` inside a recorded path is substituted with the current
  fixture run directory at replay time so the recording is portable
  across subprocess runs.

## Why this shape

Builder is KOTA's highest-volume autonomy workflow (600+ runs in
`.kota/runs/`) and has repeatedly caught workflow-layer regressions at
real cost: commit `c76400c0` added `checkCommitStageable` to the repair
loop after two builder runs burned ~$43 and ~75 agent-minutes on the
same ignore-conflict shape, and `75b22a6c` scoped `writeScope` after a
serialization gap cross-blamed concurrent agent steps. Those are
plumbing-shape regressions, not generator-quality regressions — they
are exactly what a replay-backed fixture can catch cheaply.

By replaying both the builder step and the critic judge, this fixture
exercises every workflow-layer path the real run hit:

- trigger payload round-trips through the subprocess executor to
  `inspect-ready-queue`;
- the agent step's writeScope/mutation attribution runs against the
  replay's file operations the same way it runs against a real agent's
  Write/Edit/Bash calls;
- every phase-0 and phase-1 repair check runs (the stub package.json
  makes pnpm-script shell-outs idempotent — they are enforced by
  KOTA's own CI against real source, not re-enforced here);
- the phase-2 critic-review check runs through the same harness
  registration the generator step used, via the judge-prompt recording;
- the terminal `git add -A -- <paths>` commit staging is exercised with
  the exact path set the real run produced, including the nested
  `initial/.kota/` path that motivated the repo-root `!` negation in
  commit `a840041d` (the fixture's own `.gitignore` mirrors the
  negation).

## Complementary fixtures

The three existing live-LLM builder fixtures (`builder-trivial-edit`,
`builder-multi-point-wiring`, `builder-resume-doing-task`) stay live
because each encodes a generator-quality failure mode replay cannot
cover: smoke plumbing on a minimum-viable build, the partial-wiring
"missed one Done When" failure shape, and the "resume doing/ before
pulling ready/" pickup discipline. Replay proves the workflow-layer
substrate is intact; those fixtures prove the agent still handles
specific past failure modes. The roles are complementary, not
overlapping.

## Recorder extraction

The fixture was assembled by hand with the same workflow the decomposer
replay fixture used:

1. Lift the agent-step response envelope from the source run's
   `steps/build.json` `output` block (`text`, `subtype`, `turns`,
   `totalCostUsd`, `inputTokens`, `outputTokens`, `sessionId`) into
   `recordings/build.json.response`.
2. Lift the critic verdict text from the source run's
   `critic-review.json` into `recordings/critic-review.json.response.text`.
3. Assemble `recordings/build.json.fileOperations` from the six files the
   real commit touched (task file rename + four new files + one edit),
   plus the three run-directory artifacts the builder always writes
   (`success-criteria.txt`, `success-criteria-verified.txt`,
   `commit-message.txt`). Task moves from `pnpm kota task move` do not
   round-trip through the recorder yet, so the delete/write pair for the
   task file is authored directly with the exact pre- and post-edit
   contents captured from `git show <commit>`.
4. Author the fixture's `initial/` tree by pulling each file the source
   commit ADDED or EDITED from its pre-commit parent (`git show
   <commit>^:<path>`), so HEAD at fixture replay time matches the repo
   state the real builder saw.

If a future recorder upgrade auto-extracts task-move Bash calls, the
hand-written delete/write entries in `recordings/build.json` can be
dropped in favor of the recorder's output; no predicate changes would
be required.
