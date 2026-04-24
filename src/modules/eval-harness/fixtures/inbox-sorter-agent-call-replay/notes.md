# inbox-sorter-agent-call-replay fixture

End-to-end replay of inbox-sorter's `sort-inbox` agent step through the
eval-harness replay adapter, plus the surrounding `inspect-inbox` and
`commit` steps. The fixture regression-gates the inbox-sorter workflow-
layer paths — the four repair checks (`task-queue-valid` with
`--min-ready 0`, `no-scratch-artifacts`, `commit-message-exists`,
`commit-stageable`), the `inspect-inbox` `needsAttention` gating, the
`autonomy.inbox.available` trigger receipt path, and the terminal
commit step — against the same subprocess executor path the daemon runs
in production, without invoking a real LLM.

Source run: `2026-04-24T22-53-55-335Z-inbox-sorter-1u1xc9` — the real
inbox-sorter run that committed `241b3382` ("Graduate broken
decomposer-replay-fixture inbox note into a p1 ready task"). That run
sorted the lone inbox capture (`note-broken-decomposer-replay-fixture.md`)
into one normalized p1 ready-queue task and emitted the run-directory
`commit-message.txt`, with no repair iterations.

## Shape

- `initial/` seeds the minimal repo scaffolding inbox-sorter needs:
  - `package.json` whose script entries (`build`, `typecheck`, `lint`,
    `lint:fix`, `test`) are idempotent `"true"` no-ops and `validate-tasks`
    forwards to KOTA's own `validate-queue.js` via `$KOTA_DIST_DIR`.
  - Stub `dist/cli.js` for any `node dist/cli.js …` call the fixture
    project makes.
  - A `.gitignore` covering `.kota/` and `node_modules/`.
  - `data/inbox/note-broken-decomposer-replay-fixture.md` carrying the
    real inbox capture from before the source-run commit
    (`git show 241b3382^:data/inbox/note-broken-decomposer-replay-fixture.md`).
  - No seeded `data/tasks/` tree: the recorded sort-inbox response writes
    one new ready-queue task into a fresh `data/tasks/ready/` directory,
    so the fixture exercises the create-tasks-tree-on-first-write path
    that production inbox-sorter runs hit on a fresh repo.

- `recordings/sort-inbox.json` carries the inbox-sorter agent's real
  response envelope and the commit-diff `fileOperations` that reproduce
  the post-agent repo state the source run produced: the inbox capture
  deletion, the one new ready-queue task file
  (`task-fix-broken-decomposer-agent-call-replay-fixture-so.md`,
  `priority: p1`), and the `{{runDir}}`-templated run-directory artifact
  (`commit-message.txt`). Every entry was written by
  `pnpm kota eval record-agent-step --run-id
  2026-04-24T22-53-55-335Z-inbox-sorter-1u1xc9 --step sort-inbox
  --fixture inbox-sorter-agent-call-replay`; no hand-authored
  fileOperations.

- `{{runDir}}` inside a recorded path is substituted with the current
  fixture run directory at replay time so the recording is portable
  across subprocess runs.

## Why this shape

Inbox-sorter is the fifth load-bearing autonomy workflow to gain replay-
backed regression coverage. Its workflow-layer surface is narrower than
explorer or improver but distinct from decomposer/builder: the trigger
event (`autonomy.inbox.available`) and the `inspect-inbox`
`needsAttention` gating shape are unique to this workflow, and a
regression in either path today only surfaces during the weekly cadence
run. The two existing inbox-sorter live fixtures (`inbox-sorter-smoke`,
`inbox-sorter-dedup-against-open-tasks`) gate generator-quality
decisions (the real-LLM normalize-one-idea path, the
dedup-against-existing-tasks decision). They cannot cheaply gate
plumbing — every cadence iteration pays for a real agent call.

By replaying the sort-inbox step, this fixture exercises every
workflow-layer path the real run hit after trigger receipt:

- trigger payload round-trips through the subprocess executor to
  `inspect-inbox` (the `_runId` forces a deterministic run directory
  the predicates read from);
- the `inspect-inbox` step counts inbox entries, asserts no
  outside-inbox tracked changes are present, and resolves
  `needsAttention: true`, gating the agent step on real
  `getRepoTaskQueueSnapshot` output rather than a mocked predicate;
- the agent step's writeScope (`data/`) absorbs the replay's file
  operations the same way it absorbs a real agent's Write/Edit/Bash
  calls;
- every repair check runs (`task-queue-valid` via the stubbed
  `validate-tasks` script that forwards to KOTA's own validator against
  the fixture project root with `--min-ready 0` so the post-sort empty
  ready-queue baseline is acceptable; `no-scratch-artifacts`,
  `commit-message-exists`, `commit-stageable` operate on the replay's
  staged mutations);
- the terminal `git add -A` commit succeeds against the replay's exact
  mutation set.

## Smoke-gate inclusion

This fixture is wired into `replay-smoke.test.ts`'s `SMOKE_FIXTURE_IDS`
alongside the decomposer/improver/explorer replays. It exercises a
workflow-runtime branch the existing three smoke fixtures do not — the
`autonomy.inbox.available` trigger receipt path, the `inspect-inbox`
`needsAttention` gating shape (which runs a `getRepoTaskQueueSnapshot`
and a tracked-changes-outside-inbox guard before the agent step), and
the inbox-sorter-specific repair-check tuple (`task-queue-valid` with
`--min-ready 0` rather than the strategic-coverage variant the explorer
fixture runs). A regression in any of those paths now blocks a
`pnpm test` run instead of surviving until the weekly cadence.

## Complementary fixtures

`inbox-sorter-smoke` and `inbox-sorter-dedup-against-open-tasks` stay
live-LLM fixtures: their job is to regression-gate generator quality
(the real-LLM normalize-one-idea path and the
dedup-against-existing-tasks decision encoded from source run
`2026-04-15T21-20-03-042Z-inbox-sorter-j7lclg`). The three fixtures
cover complementary surfaces: the live ones pay for real LLM calls to
probe generator quality, this one pays zero LLM cost to pin
workflow-layer plumbing.

With this fixture, all five load-bearing recurring autonomy workflows
(decomposer, builder, improver, explorer, inbox-sorter) now have
recorded-agent-step replay coverage.

## Recorder extraction

The recording is produced by `pnpm kota eval record-agent-step` with no
hand-authored files. One invocation:

- `pnpm kota eval record-agent-step --run-id
  2026-04-24T22-53-55-335Z-inbox-sorter-1u1xc9 --step sort-inbox
  --fixture inbox-sorter-agent-call-replay` writes
  `recordings/sort-inbox.json`. The recorder resolves the source run's
  commit SHA from `steps/commit.json` (`241b3382637f…`) and walks that
  commit's diff, so every `fileOperations` entry for a repo-tree path
  comes directly from `git show <sha>:<path>`. Run-directory artifacts
  (`commit-message.txt`) are not committed, so they come from the
  Write-event scan of the step's `events.jsonl` and stay templated to
  `{{runDir}}`.

Re-extraction after a better source run exists (e.g. one whose
sort decision drops the inbox capture without scaffolding a task, so
the recorded mutations exercise a different workflow-layer shape) is a
single CLI call.
