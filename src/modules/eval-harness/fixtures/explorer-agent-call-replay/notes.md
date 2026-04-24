# explorer-agent-call-replay fixture

End-to-end replay of explorer's `explore` agent step through the eval-harness
replay adapter, plus the three post-agent steps (`record-exploration`,
`apply-watchlist-updates`, `commit`) that fire after a successful explore.
The fixture regression-gates the explorer workflow-layer paths — the five
repair checks (`task-queue-valid`, `architecture-ready-coverage`,
`strategic-ready-coverage`, `no-scratch-artifacts`, `commit-message-exists`,
`commit-stageable`), the `explorer-state.json` timestamp rewrite, the
`watchlist-updates.json` reader, the commit step's staging, and the
terminal commit — against the same subprocess executor path the daemon runs
in production, without invoking a real LLM.

Source run: `2026-04-24T22-26-19-626Z-explorer-tocx88` — the real explorer
run that committed `a04e3432` ("Seed empty queue with p1 task to gate
replay fixtures from pnpm test"). That run's `apply-watchlist-updates`
output was `{ applied: [] }` (no watchlist mutations), so the recorded
fileOperations are just the one p1 task file and the run-directory
`commit-message.txt`.

## Shape

- `initial/` seeds the minimal repo scaffolding explorer needs:
  - `package.json` whose script entries (`build`, `typecheck`, `lint`,
    `lint:fix`, `test`) are idempotent `"true"` no-ops and `validate-tasks`
    forwards to KOTA's own `validate-queue.js` via `$KOTA_DIST_DIR`.
  - Stub `dist/cli.js` for any `node dist/cli.js …` call the fixture
    project makes.
  - A `.gitignore` mirroring the repo-root unignore shape so the fixture's
    `.kota/explorer-state.json` seed stays tracked while the rest of
    `.kota/` (e.g. `.kota/runs/<id>/` the workflow creates at run time)
    stays ignored.
  - `data/watchlist.yaml` with one `seen` entry so `inspect-watchlist`
    has something parseable to expose — the content is immaterial because
    the replay adapter ignores agent inputs; this is about proving the
    parser survives.
  - `.kota/explorer-state.json` with a `{{NOW_MINUS_HOURS:6}}` templated
    timestamp old enough for `explorationRefreshDue` to fire on every
    materialization. The fixture runner's `applyFixtureTemplates` rewrites
    the placeholder at copy time (the same pattern the improver fixture
    uses to keep its `actionableRunAt` seed fresh without sliding-date
    brittleness).
  - Empty `data/tasks/` tree: no seeded tasks, so
    `queueEmpty && explorationRefreshDue` makes `needsAttention: true`.
    The recorded replay writes the one `data/tasks/ready/task-*.md` the
    real run landed into the empty queue.

- `recordings/explore.json` carries the explorer agent's real response
  envelope and the commit-diff `fileOperations` that reproduce the
  post-agent repo state the source run produced: the one new ready-queue
  task file (`task-gate-shipped-replay-fixtures-from-pnpm-test-so-wor.md`,
  `priority: p1`) and the `{{runDir}}`-templated run-directory artifact
  (`commit-message.txt`). Both entries were written by
  `pnpm kota eval record-agent-step`; no hand-authored fileOperations.

- `{{runDir}}` inside a recorded path is substituted with the current
  fixture run directory at replay time so the recording is portable
  across subprocess runs.

## Why this shape

Explorer is the fourth load-bearing autonomy workflow to gain replay-backed
regression coverage. Its workflow layer has the widest post-agent surface
of any autonomy workflow besides improver: a state-file rewrite
(`record-exploration` touches `.kota/explorer-state.json`), a JSON-reader
step that applies operator-authored watchlist mutations
(`apply-watchlist-updates`), five repair checks, and a terminal commit
step. Those are all plumbing-shape contracts that replay can catch
cheaply — generator-quality regressions (the real explore-step judgment)
still land in production runs and in the complementary live fixture
(`explorer-strategic-ready-trip`).

The fixture's `initial/` seed has to do one job the builder/decomposer
fixtures did not: keep `needsAttention: true` on every materialization.
Explorer's agent gate is:

```
needsAttention = !dirty && (queueEmpty || queueThin) && explorationRefreshDue
```

`queueEmpty` is deterministic (the seed has an empty `data/tasks/` tree).
`explorationRefreshDue` compares `Date.now() - lastExplorationAt` against
a 30-minute threshold, so a hard-coded `lastExplorationAt` would silently
stop firing once the fixture aged past threshold. The runner's
`applyFixtureTemplates` rewrites `{{NOW_MINUS_HOURS:6}}` on every
materialization so the seed always looks at least six hours old at replay
time — the same pattern `improver-agent-call-replay` uses for its
evidence-gate seed.

By replaying the explore step, this fixture exercises every workflow-layer
path the real run hit after trigger receipt:

- trigger payload round-trips through the subprocess executor to
  `inspect-queue` and `inspect-watchlist` (the `_runId` forces a
  deterministic run directory the predicates read from);
- the agent step's writeScope (`data/tasks/`, `data/watchlist.yaml`) absorbs
  the replay's file operations the same way it absorbs a real agent's
  Write/Edit/Bash calls;
- every repair check runs (`task-queue-valid` via the stubbed
  `validate-tasks` script that forwards to KOTA's own validator against
  the fixture project root; `architecture-ready-coverage` and
  `strategic-ready-coverage` inspect the same `data/tasks/ready/` tree;
  `no-scratch-artifacts`, `commit-message-exists`, `commit-stageable`
  operate on the replay's staged mutations);
- `record-exploration` rewrites `.kota/explorer-state.json`;
- `apply-watchlist-updates` reads the run directory's
  `watchlist-updates.json` (absent in this source run — the step records
  an empty-apply success, which is itself a gated plumbing path);
- the terminal `git add -A` commit succeeds against the replay's exact
  mutation set.

## Complementary fixtures

`explorer-strategic-ready-trip` stays a live-LLM fixture: its job is to
regression-gate the `strategic-ready-coverage` repair trip against real
generator judgment (an agent that might drift into `p3`-only work under a
thin-queue trigger). The two fixtures cover complementary surfaces:
the live one pays for a real LLM call to probe generator quality, this one
pays zero LLM cost to pin workflow-layer plumbing.

With this fixture, all four load-bearing autonomy workflows (decomposer,
builder, improver, explorer) now have recorded-agent-step replay coverage.

## Recorder extraction

The recording is produced by `pnpm kota eval record-agent-step` with no
hand-authored files. One invocation:

- `pnpm kota eval record-agent-step --run-id
  2026-04-24T22-26-19-626Z-explorer-tocx88 --step explore --fixture
  explorer-agent-call-replay` writes `recordings/explore.json`. The
  recorder resolves the source run's commit SHA from `steps/commit.json`
  (`a04e3432053a…`) and walks that commit's diff, so every
  `fileOperations` entry for a repo-tree path comes directly from
  `git show <sha>:<path>`. Run-directory artifacts (`commit-message.txt`)
  are not committed, so they come from the Write-event scan of the
  step's `events.jsonl` and stay templated to `{{runDir}}`.

Re-extraction after a better source run exists (e.g. one whose
`watchlist-updates.json` is non-empty so the `applyWatchlistUpdates`
apply-path is exercised end-to-end) is a single CLI call.
