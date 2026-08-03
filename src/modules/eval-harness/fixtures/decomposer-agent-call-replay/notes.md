# decomposer-agent-call-replay fixture

End-to-end replay of decomposer's `decompose` agent step through the
eval-harness replay adapter. The fixture regression-gates the
`shouldDecompose: true` branch identified as uncovered in
`src/modules/eval-harness/fixtures/uncovered/notes.md`.

## Shape

- `initial/` seeds a failed-builder run with `errorKind: step-timeout`, its
  durable `task-claim.json`, and the matching claimed `doing/` task. The
  fixture subprocess runs `kota workflow exec decomposer` with the
  builder-failure trigger payload, so `assess-failure` resolves
  `shouldDecompose: true` and the `decompose` agent step fires.
- `recordings/decompose.json` carries the recorded response envelope
  and a typed decomposition plan. Its `fileOperations` is empty because
  the production `apply-decomposition` code step owns task creation,
  dependency wiring, parent retirement, and commit-message creation
  through the canonical task APIs.
- The plan produces the two task ids asserted by the fixture and
  includes every section required by current open-task validation.

## Why this shape

The replay exercises trigger routing, assessment, typed agent-output
validation, deterministic task mutation, task queue validation, commit,
and restart against the production workflow. Only the agent harness is
replaced, so a regression from failure attribution through committed
subtask state fails without paying for a live model call.
