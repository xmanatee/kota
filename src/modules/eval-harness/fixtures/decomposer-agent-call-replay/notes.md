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
  `2026-04-18T15-45-49-339Z-decomposer-zloyo6`) and the set of file
  operations that mirror the post-agent state the real decomposer run
  produced (original task moved to `dropped/` with a `## Decomposed`
  section, two ready-queue subtasks, run-directory
  `commit-message.txt` and `notes.md`).
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
