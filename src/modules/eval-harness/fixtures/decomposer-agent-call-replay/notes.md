# decomposer-agent-call-replay fixture

End-to-end replay of decomposer's `decompose` agent step through the
eval-harness replay adapter. The fixture regression-gates the
`shouldDecompose: true` branch identified as uncovered in
`src/modules/eval-harness/fixtures/uncovered/notes.md`.

## Shape

- `initial/` seeds a timeout-shaped failed-builder run and the
  matching claimed `doing/` task. The fixture subprocess runs
  `kota workflow exec decomposer` with the builder-failure trigger
  payload, so `assess-failure` resolves `shouldDecompose: true` and
  the `decompose` agent step fires.
- `recordings/decompose.json` carries the recorded agent response
  envelope (lifted from source run
  `2026-04-18T15-45-49-339Z-decomposer-zloyo6`) and a hand-authored set
  of file operations that model what a successful decomposer run of
  this shape would produce: original task moved to `dropped/` with a
  `## Decomposed` section, two ready-queue subtasks, run-directory
  `commit-message.txt` and `notes.md`. The `fileOperations` list is not
  auto-extractable by `pnpm kota eval record-agent-step` because no
  decomposer source run has ever produced `commit.committed: true` —
  decomposer runs that ran the `decompose` agent step still ended the
  commit step as no-op today. When a real committing decomposer run is
  available, its source id can replace this fixture's provenance and
  the recording can be re-extracted in one CLI call.
- The two recorded ready-queue subtask bodies were patched in place
  after the open-task quality gates landed (`## Source / Intent`,
  `## Acceptance Evidence`, `## Initiative` now required for `p0`/`p1`
  /`p2` open tasks). The original source-run snapshot predated those
  gates, so its decomposed subtasks would fail the `task-queue-valid`
  repair check and trip the `pass^k` drag this fixture is meant to
  prevent. The patch only adds the missing required sections; the
  decomposer's regression-gating shape (file-absent on `doing/`,
  file-exists in `dropped/`, `## Decomposed` section, two ready-queue
  subtasks, agent + commit step success in `metadata.json`,
  `committed: true`) is unchanged. The next time a real committing
  decomposer source run produces subtasks that already satisfy current
  validation, this recording can be re-extracted via
  `pnpm kota eval record-agent-step` and the patch dropped.
- `{{runDir}}` inside a recorded path is substituted with the current
  run directory at replay time so the recording is portable across
  subprocess runs.

## Why this shape

The replay exercises the full decomposer workflow — trigger routing,
assess-failure decision gate, `decompose` agent step, the four
decomposer repair-loop checks (task queue validator, scratch-artifact
guard, commit-message gate, commit-stageable dry-run), the commit
step, and the restart request — against the same runtime the daemon
runs in production. Only the harness boundary is swapped, so a
regression anywhere between trigger receipt and commit completion
trips this fixture loudly without paying for a real LLM run.
