# improver-agent-call-replay fixture

End-to-end replay of improver's `improve` agent step through the eval-harness
replay adapter, including the `semantic-quality-gate` judge call every
improver run invokes after staging. The fixture regression-gates the improver
workflow-layer paths — gather-run-data, evidence-gate decision, the full
repair loop (build-output, workflow-validate, task-queue-valid, typecheck,
lint, test, no-scratch-artifacts, commit-message-exists, commit-stageable,
semantic-quality-gate), record-evidence-fingerprint, commit, write-run-
summary, and the restart request — against the same subprocess executor
path the daemon runs in production, without invoking a real LLM.

## Shape

- `initial/` seeds the minimal repo scaffolding improver needs:
  - `package.json` whose script entries (`build`, `typecheck`, `lint`,
    `lint:fix`, `test`) are idempotent `"true"` no-ops and `validate-tasks`
    forwards to KOTA's own `validate-queue.js` via `$KOTA_DIST_DIR`.
  - Stub `dist/cli.js` for `node dist/cli.js workflow validate`.
  - A `.gitignore` that mirrors the repo-root unignore for nested fixture
    `initial/.kota/` paths so the workflow's `git add -A` stages cleanly.
  - `.kota/runs/fxt-failed-builder-seed/metadata.json`: one seeded non-
    improver failed run with `{{NOW_MINUS_HOURS:1}}` templated timestamps.
    The runner's fixture-templating pass rewrites those placeholders at
    materialization time so the evidence gate always sees a fresh
    actionable run inside its 24-hour window and decides `shouldRun: true`
    deterministically — without a sliding-timestamp failed run, the
    `improve` agent step would be gated off and the fixture would never
    exercise the agent-call path.
  - The pre-edit state of the nine files the real run committed
    (`src/modules/autonomy/commit.ts`, `commit.test.ts`,
    `workflows/AGENTS.md`, `workflows/builder/repair-checks.ts`, and the
    `workflow.ts` definitions for decomposer, explorer, improver, inbox-
    sorter, and research-retry). Each file was pulled from the source
    commit's parent via `git show <commit>^:<path>`, the same extraction
    mode the recorder uses for `fileOperations`. The replay's post-agent
    writes turn this pre-commit tree into the post-commit tree.

- `recordings/improve.json` carries the improver agent's real response
  envelope and the full commit-diff `fileOperations` that reproduce the
  post-agent repo state the source run produced: the edits across all
  nine repo-tree files plus the `{{runDir}}`-templated run-directory
  artifact (`commit-message.txt`).

- `recordings/semantic-gate-review.json` carries the real semantic-gate
  verdict JSON the source run persisted to `<runDir>/semantic-gate-review
  .json`. The replay adapter routes any judge prompt starting with
  `## Commit message` to this recording, mirroring how a `## Task (what
  was asked)` header routes to `critic-review`.

- `{{runDir}}` inside a recorded path is substituted with the current
  fixture run directory at replay time so the recording is portable
  across subprocess runs.

## Why this shape

Improver is the third load-bearing autonomy workflow (953 non-success runs
across the last 7d in the source aggregate). Its workflow layer has the
widest post-agent surface of any autonomy workflow: an evidence gate with
its own persistent state file, a judge check with a distinct user-message
shape, and a commit step that has to stage across unrestricted `writeScope`.
Those are all plumbing-shape contracts that replay can catch cheaply —
generator-quality regressions still land in production runs.

The fixture's `initial/` seed has to do two jobs the builder fixture's
seed did not:

1. Make the evidence gate fire. Improver gates its agent call on
   `aggregateRunOutcomes(.kota/runs/).latestActionableRunAt`, which uses
   `Date.now()` for its 24h cutoff. A hard-coded date would silently age
   out; the runner's `applyFixtureTemplates` rewrites
   `{{NOW_MINUS_HOURS:N}}` placeholders on every materialization so the
   seed metadata always looks recent at replay time.
2. Support the semantic-quality-gate judge routing. Improver's
   `createImproverSemanticCheck` user message starts with
   `## Commit message`, not the critic's `## Task (what was asked)`. The
   replay adapter matches that header and routes to the
   `semantic-gate-review` recording id.

By replaying both the improver step and the semantic-gate judge, this
fixture exercises every workflow-layer path the real run hit:

- trigger payload round-trips through the subprocess executor to
  `gather-run-data` and the evidence gate (the `_runId` forces a
  deterministic run directory the predicates read from);
- the agent step's writeScope (unrestricted for improver) absorbs the
  replay's file operations the same way it absorbs a real agent's Write/
  Edit/Bash calls;
- every phase-0 and phase-1 repair check runs (the stub package.json
  makes pnpm-script shell-outs idempotent — they are enforced by KOTA's
  own CI against real source, not re-enforced here);
- the phase-2 semantic-quality-gate check dispatches through the same
  harness registration the generator step used, via the judge-prompt
  recording;
- the evidence-gate fingerprint and terminal `git add -A` commit both
  succeed against the replay's exact mutation set.

## Complementary fixtures

The existing builder (`builder-agent-call-replay`) and decomposer
(`decomposer-agent-call-replay`) replay fixtures cover their own
workflow-layer substrate. This fixture pins the third load-bearing
autonomy workflow and retires the last entry in `fixtures/uncovered/
notes.md` that predated today's scaffold pattern.

## Recorder extraction

Both recordings are produced by `pnpm kota eval record-agent-step`
with no hand-authored files. One invocation per agent call:

- `pnpm kota eval record-agent-step --run-id
  2026-04-24T17-23-37-109Z-improver-tqqgmc --step improve --fixture
  improver-agent-call-replay` writes `recordings/improve.json`. The
  recorder resolves the source run's commit SHA from `steps/commit.json`
  and walks that commit's diff, so every `fileOperations` entry for a
  repo-tree path comes directly from `git show <sha>:<path>`. Run-
  directory artifacts (`commit-message.txt`) are not committed, so they
  come from the Write-event scan of the step's `events.jsonl` and stay
  templated to `{{runDir}}`.
- `pnpm kota eval record-agent-step --run-id
  2026-04-24T17-23-37-109Z-improver-tqqgmc --judge semantic-gate-review
  --fixture improver-agent-call-replay` writes
  `recordings/semantic-gate-review.json`. The judge mode reads the source
  run's `<runDir>/semantic-gate-review.json` verdict (the normalized JSON
  `handleVerdict` persists via `ARTIFACT_NAME`) and wraps it as
  `response.text`. `fileOperations` is always empty for judge recordings
  — a judge call has no tool access by contract.

The fixture's `initial/` tree is authored separately by pulling each
file the source commit ADDED or EDITED from its pre-commit parent
(`git show <commit>^:<path>`), so HEAD at fixture replay time matches
the repo state the real improver saw.
