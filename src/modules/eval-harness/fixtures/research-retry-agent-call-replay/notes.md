# research-retry-agent-call-replay fixture

End-to-end replay of research-retry's `retry` agent step through the
eval-harness replay adapter, plus the surrounding `inspect-candidates`,
`mark-attempt`, and `commit` steps. The fixture regression-gates the
research-retry workflow-layer paths — the `inspect-candidates`
candidate-selection and capability-evaluation logic
(`candidates.ts`/`precondition.ts`/`runtime-detect.ts`), the four
repair-loop checks (`task-queue-valid`, `no-scratch-artifacts`,
`commit-message-exists`, `commit-stageable`), the `mark-attempt`
fingerprint-marker writeback, and the terminal commit step — against
the same subprocess executor path the daemon runs in production,
without invoking a real LLM.

Source run: `2026-04-23T00-03-55-062Z-research-retry-u92f1u` — the
real research-retry run that committed `f4b4b279`
("Re-confirm research-retry blocker with rotated
akshay_pachaar/tianle_cai spot checks"). That run inspected the
canonical research blocker, retried its X/Twitter URLs, re-confirmed
HTTP 402 on the rotated spot-check pair, edited the task's status
section accordingly, and emitted the run-directory `commit-message.txt`
with no repair iterations.

Source-commit SHA was passed explicitly to the recorder
(`--source-commit-sha f4b4b279...`) because pre-existing research-retry
`steps/commit.json` artifacts predate the SHA capture in the commit
step. The recorder still enforced `committed: true` from the source
artifact so a non-committing run could not be silently recorded.

## Shape

- `initial/` seeds the minimal repo scaffolding research-retry needs:
  - `package.json` whose script entries (`build`, `typecheck`, `lint`,
    `lint:fix`, `test`) are idempotent `"true"` no-ops and
    `validate-tasks` forwards to KOTA's own `validate-queue.js` via
    `$KOTA_DIST_DIR`.
  - Stub `dist/cli.js` for any `node dist/cli.js …` call the fixture
    project makes.
  - A `.gitignore` covering `.kota/` and `node_modules/`.
  - One synthetic blocked task at
    `data/tasks/blocked/task-fixture-research-blocker.md`. Its
    `## Resources` section carries one plain-http URL
    (`https://example.com/research-retry-fixture-resource`) — no
    `x.com/.../status/...` and no `openai.com/index/…`. That's the
    minimum a hermetic fixture can satisfy, because today's
    `runtime-detect.isPlaywrightAvailable()` `require.resolve`s
    `playwright` from KOTA's tree and KOTA does not depend on
    Playwright. With `playwrightAvailable=false` and
    `authProfileExists=false` the only `isUrlReadable=true` URL class
    is `plain-http`. The task is `priority: p3` so the open-task
    quality gates do not require a `## Initiative` section.

- `recordings/retry.json` carries the research-retry agent's real
  response envelope and the commit-diff `fileOperations` that reproduce
  the post-agent repo state the source run produced: the modified
  research-blocker task content
  (`task-review-inaccessible-research-resources-when-access.md`) and
  the `{{runDir}}`-templated run-directory artifact
  (`commit-message.txt`). The recording's response, file paths, file
  count, and `commit-message.txt` body are verbatim from the source
  run via `pnpm kota eval record-agent-step --run-id
  2026-04-23T00-03-55-062Z-research-retry-u92f1u --step retry
  --fixture research-retry-agent-call-replay --source-commit-sha
  f4b4b279...`. Two `## Source / Intent` and `## Acceptance Evidence`
  sections were patched into the recorded blocker-task body to satisfy
  the open-task quality gates that landed in commit `34c2dd19` (April
  24 2026), after every committing research-retry source run. Without
  the patch the `task-queue-valid` repair check fails on every replay
  and the workflow tries to repair against a recording the adapter
  cannot replay. The patch matches the route the broken-decomposer
  fixture task documented as the in-place fallback: keep the rest of
  the recording (envelope, file ops, file paths, `commit-message.txt`)
  intact, only add the missing required sections. Once a research-
  retry source run lands after `34c2dd19` (which requires today's
  Playwright + auth-profile capability constraints to actually let the
  workflow pull a real candidate), re-record without `--source-commit-
  sha` and drop the patch.

- `{{runDir}}` inside a recorded path is substituted with the current
  fixture run directory at replay time so the recording is portable
  across subprocess runs.

## Why the seeded task is synthetic

The source run targeted `task-review-inaccessible-research-resources-
when-access`, whose `## Resources` block carries only `x.com` URLs.
After the capability-skip logic landed in commit `2c6100e1` (April
2026), today's `inspect-candidates` returns `skipReason:
capability-absent` for that task under the hermetic
no-Playwright/no-profile profile a fixture can offer, and the `retry`
agent step short-circuits — defeating the regression gate the fixture
exists to provide. Seeding a synthetic plain-http blocker is the only
way to keep `inspect-candidates` selecting a candidate while staying
hermetic. The recording's writes still apply against the real
source-run task path; both files exist post-replay, both are committed,
and the predicates assert against the seeded task (the candidate
`mark-attempt` writes the fingerprint marker into) and the source-run
task (proof the recording's mutations replayed).

## Why this shape

Research-retry is the sixth load-bearing agent-bearing autonomy
workflow to gain replay-backed regression coverage. Its
workflow-runtime surface is distinct from the other five replays:

- The `autonomy.queue.available` trigger receipt path with a
  research-retry-specific `inspect-candidates` step that consults
  `runtime-detect.ts` for Playwright + `modules.browser.storageStatePath`,
  walks `data/tasks/blocked/` oldest-first via `candidates.ts`, and
  evaluates each candidate's URL set against the current capability
  via `precondition.ts`'s `evaluateCandidate` (URL classification,
  marker fingerprint, capability gating).
- The `mark-attempt` post-agent step that re-reads the candidate's
  task body from `blocked/`, computes the fresh URL fingerprint, and
  upserts the `<!-- research-retry-attempt: fingerprint=… -->` marker.
- The research-retry-specific repair-check tuple (`task-queue-valid`
  with default `min-ready`, `no-scratch-artifacts`,
  `commit-message-exists`, `commit-stageable`).

The two existing `pr-reviewer` workflows are intentionally out of
scope: their external-context needs (real PR payload) are different
and warrant a separate fixture authoring task.

By replaying the `retry` step, this fixture exercises every
workflow-layer path the real run hit after trigger receipt:

- trigger payload round-trips through the subprocess executor to
  `inspect-candidates` (the `_runId` forces a deterministic run
  directory the predicates read from);
- `inspect-candidates` calls `checkResearchRetryCapability` (which
  loads the project KOTA config and probes Playwright resolution),
  enumerates blocked tasks via `listResearchRetryCandidates`, and
  evaluates the seeded plain-http URL as readable so `candidate !==
  null` and the `retry` step's `when` predicate fires;
- the agent step's writeScope (`data/tasks/`, `data/inbox/`,
  `src/modules/autonomy/`) absorbs the replay's file operations the
  same way it absorbs a real agent's Write/Edit/Bash calls;
- every repair check runs (`task-queue-valid` via the stubbed
  `validate-tasks` script that forwards to KOTA's own validator
  against the fixture project root; `no-scratch-artifacts`,
  `commit-message-exists`, `commit-stageable` operate on the
  replay's staged mutations);
- `mark-attempt` looks up the candidate id in `blocked/`, computes
  the URL fingerprint, and writes the marker into the task body;
- the terminal `git add -A` commit succeeds against the replay's
  exact mutation set plus the marker `mark-attempt` added.

## Smoke-gate inclusion

This fixture is wired into `replay-smoke.test.ts`'s
`SMOKE_FIXTURE_IDS` alongside the
decomposer/improver/explorer/inbox-sorter replays. It exercises
workflow-runtime branches the existing four smoke fixtures do not —
the `inspect-candidates` selection-and-evaluation path (with its
`runtime-detect` Playwright probe and `precondition.evaluateCandidate`
URL-class + marker fingerprint logic), the `mark-attempt`
post-agent fingerprint-marker writeback, and the research-retry repair
checks. A regression in any of those paths now blocks a `pnpm test`
run instead of surviving until the weekly cadence.

## Recorder extraction

The recording is produced by `pnpm kota eval record-agent-step` with
no hand-authored files. One invocation:

- `pnpm kota eval record-agent-step --run-id
  2026-04-23T00-03-55-062Z-research-retry-u92f1u --step retry
  --fixture research-retry-agent-call-replay --source-commit-sha
  f4b4b279de830e9f446f0c032ee21ba49aec2493` writes
  `recordings/retry.json`. The recorder still requires
  `output.committed === true` in the source run's `steps/commit.json`,
  then walks the explicitly-passed commit's diff so every
  `fileOperations` entry for a repo-tree path comes directly from
  `git show <sha>:<path>`. Run-directory artifacts
  (`commit-message.txt`) are not committed, so they come from the
  Write-event scan of the step's `events.jsonl` and stay templated to
  `{{runDir}}`.

Re-extraction after a future research-retry run captures its own
SHA (so `--source-commit-sha` is no longer needed) is a single CLI
call. Picking a future source run whose blocker task already carries a
plain-http URL would also let the seeded task drop in favor of the
real-task pre-commit content — until then the synthetic seed is the
honest hermetic shape.
