# Uncovered autonomy workflows

These project-shipped autonomy workflows do not currently have a real-
failure fixture under `src/modules/eval-harness/fixtures/`. Each entry
records the specific reason a fixture is not possible today and points at
the real run(s) that would motivate one once the blocker is resolved.

The shared follow-up task that tracks closing these gaps is
`task-extend-eval-harness-predicate-contract-and-bootstr` in
`data/tasks/ready/`. That task owns the predicate-contract extension, the
`triggerPayload` plumbing for `subprocess-executor.ts`, and the fixture
bootstrap needed for the dependency-heavy workflows below.

This directory is intentionally not a fixture: it has no `fixture.json`, so
`loadAllFixtures` skips it and the loader's provenance contract still
rejects any real fixture that omits `provenance.kind = "real-failure"` or
`smoke-fixture`.

## Emit-only workflows

These workflows do not mutate tracked files. Their failure mode is an
incorrect bus event, a missing bus event, a wrong-shape event payload, or
an external side effect (GitHub PR comment) — none of which the current
predicate union (`file-exists`, `file-absent`, `file-contains`,
`shell-succeeds`, `shell-fails`) can express without paper-over predicates
that trust the agent's self-report.

- **dispatcher** (987 runs in `.kota/runs/`, all `success`). Emits
  `autonomy.queue.available`, `autonomy.inbox.available`,
  `autonomy.queue.empty`, and `autonomy.queue.thin` based on the
  repo-task-queue snapshot. A regression would look like the wrong
  emit set given a seeded queue shape (e.g. an
  `autonomy.queue.thin` event with `p3`-only actionable work, when only
  `autonomy.queue.empty` should have fired). Representative healthy
  run: `2026-04-24T11-40-06-637Z-dispatcher-hmrdz8`.
- **attention-digest** (622 runs in `.kota/runs/`, all `success`).
  Emits `workflow.attention.digest` notification envelopes derived from
  recent run metadata. A regression would look like no envelope emitted
  after a monitored failure, or an envelope without the attention items
  the digest should carry. Representative healthy run:
  `2026-04-24T11-22-04-345Z-attention-digest-1r6x7s`.
- **evaluator-calibration-monitor** (75 runs, all `success`). Emits
  `evaluator-calibration.regression.detected` when the pass-verdict
  contradiction rate crosses the gate. A regression would look like the
  gate firing when it should not or not firing when it should; both are
  bus-event shapes, not file diffs. Representative healthy run:
  `2026-04-24T11-22-04-381Z-evaluator-calibration-monitor-4bbcqr`.
- **evaluator-calibration-notify** (14 runs, all `success`). Reshapes
  the monitor's typed event into a `workflow.attention.digest`
  envelope. A regression would look like a malformed attention item.
  Representative healthy run:
  `2026-04-24T11-22-04-709Z-evaluator-calibration-notify-b3mgsf`.
- **pr-reviewer** (0 runs in `.kota/runs/` on this branch). Fires on
  `github.pull_request` webhooks and posts structured feedback as a PR
  comment via the `gh` CLI. A regression would look like a missing PR
  comment, a wrong recommendation enum, or an approve where
  request-changes was warranted — all external `gh` calls, not local
  file diffs. There is no representative run yet because the webhook
  has not fired against this repo on the current branch.

Fixture coverage for this class requires a new predicate kind that
inspects the bus-event log produced by the fixture run (or, for
`pr-reviewer`, the `gh` call log). The follow-up task scopes that
contract extension.

## Dependency-heavy workflows

These workflows' failure modes *are* artifact-observable, but the harness
cannot bootstrap them today.

- **decomposer** (470 runs, all `success`). The trigger path relies on
  `payload.runDir` / `payload.runId` pointing at a failed builder run,
  and `subprocess-executor.ts` invokes `kota workflow trigger
  decomposer --force` without `--payload`. The workflow throws
  `Decomposer trigger payload must include runDir and runId` on
  `manual` triggers with no payload. Representative real-failure
  shape: run `2026-04-18T15-45-49-339Z-decomposer-zloyo6` recorded in
  its own `decompose.json` output that `assess-failure` misidentified
  the failed task by scanning `doing/` blindly, and the agent had to
  re-derive the correct target from the builder run's event log. Once
  `FixtureSpecFile.triggerPayload` is plumbed, the fixture seeds a
  fake failed-builder `.kota/runs/<id>/metadata.json` plus a stale
  `doing/` task and a real timed-out `ready/` task, and predicates
  require the real task to land in `dropped/` with two or more
  subtasks in `ready/`.
- **improver** (153 `success` / 953 non-success runs, many real
  failures; e.g. `2026-04-18T09-00-55-464Z-improver-qmp0qw`
  stream-idle timeout, `2026-04-18T15-45-49-367Z-improver-d5ziis`
  hang-timeout, `2026-04-19T21-48-02-148Z-improver-tk3g6n` repair
  iteration with real `pnpm test` failures). The workflow reads the
  whole `.kota/runs/` aggregate and edits KOTA source, prompts, and
  tests. A fixture would have to materialize a realistic subset of
  KOTA's source tree (enough for `pnpm build`, `pnpm typecheck`,
  `pnpm lint`, `pnpm test`, and `workflow validate` to succeed) and a
  representative run-history sample. That bootstrap is an order of
  magnitude larger than any existing fixture's `initial/` tree and
  needs an explicit harness capability (e.g. a "clone from KOTA
  source" seed step) to stay honest about fixture isolation.
- **research-retry** (56 runs, all `success`). The workflow retries
  blocked research tasks using authenticated-browser and rendered-
  browser tools contributed by the browser module. The harness
  subprocess runs with `HOME` remapped to the fixture working dir and
  no credentials, so the retry step cannot exercise the browser path
  it exists to retry. A real-failure fixture needs a bootstrap that
  either swaps in a browser fake that mirrors the blocked-source
  shape, or stubs the capability at the module loader. Representative
  healthy run: `2026-04-22T17-57-16-377Z-research-retry-w6qkkb`.

Fixture coverage for this class requires the `triggerPayload` plumbing
plus workflow-specific bootstrap (KOTA-source seeding for `improver`,
browser-capability stub for `research-retry`). The follow-up task scopes
that work.
