# explorer-agent-call-replay fixture

End-to-end replay of explorer's `explore` agent step through the eval-harness
replay adapter, plus the post-agent publication and watchlist-update steps that
run after a successful exploration. The fixture regression-gates the current
repair checks (`task-queue-valid` and `watchlist-update-commit-message`), the
staged explorer-publication request, the `watchlist-updates.json` reader, and
runtime-owned integration through the same subprocess executor path used in
production, without invoking a real LLM.

Source run: `2026-04-24T22-26-19-626Z-explorer-tocx88`, which committed
`a04e3432` ("Seed empty queue with p1 task to gate replay fixtures from pnpm
test"). Its `apply-watchlist-updates` output was `{ applied: [] }`, so the
current recording writes one p1 task and the run-directory
`commit-message.txt` artifact.

## Shape

- `initial/` seeds the minimal repo scaffolding explorer needs:
  - `package.json` supplies deterministic no-op project scripts and forwards
    `validate-tasks` to KOTA's validator via `$KOTA_DIST_DIR`.
  - Stub `dist/cli.js` supports fixture-project CLI calls.
  - A `.gitignore` mirrors the repo-root `.kota/` ignore shape.
  - `data/watchlist.yaml` contains one parseable `seen` entry so
    `inspect-watchlist` exercises the reader.
  - The task tree is empty and no prior explorer cooldown state is seeded, so
    `queueEmpty && explorationRefreshDue` makes `needsAttention: true`.
- `recordings/explore.json` carries the explorer agent's source response
  envelope and current replay operations: one new ready task
  (`task-gate-shipped-replay-fixtures-from-pnpm-test-so-wor`, priority `p1`)
  plus `{{runDir}}/commit-message.txt`.
- `{{runDir}}` is substituted with the current fixture run directory at replay
  time so the recording is portable across subprocess runs.

## Why this shape

Explorer has a broad post-agent surface: a staged publication request, a
reader that applies agent-authored watchlist updates, two repair checks, and
runtime-owned writer integration. The replay covers those plumbing contracts
without grading the open-ended quality of the source agent's exploration.

The absent task and cooldown state keep the agent gate deterministic:

```
needsAttention = !dirty && !locallyBlocked && queueNeedsExploration && explorationRefreshDue
```

By replaying the explore step, the fixture verifies that:

- trigger payload and canonical explorer state reach `inspect-queue`, while
  the seeded watchlist reaches `inspect-watchlist`;
- the agent write scope consumes the recorded task and commit-message writes;
- `task-queue-valid` forwards to KOTA's validator against the fixture project,
  and `watchlist-update-commit-message` validates the current run-directory
  contract;
- `record-exploration-publication` stages the state update that becomes durable
  only after writer integration;
- `apply-watchlist-updates` handles an absent update report as an empty apply;
- runtime-owned writer integration publishes the replayed mutation set.

Only the two current repair checks are represented. Generator judgment remains
outside this replay fixture's scope.

## Recorder extraction

The recording originates from:

```sh
pnpm kota eval record-agent-step \
  --run-id 2026-04-24T22-26-19-626Z-explorer-tocx88 \
  --step explore \
  --fixture explorer-agent-call-replay
```

The recorder resolves the source commit from `steps/commit.json` and walks its
diff for repo-tree operations. The curated recording retains
`commit-message.txt`, the sole current agent-authored run-directory artifact.
A future source run with a non-empty `watchlist-updates.json` can extend the
fixture to cover the watchlist apply path.
