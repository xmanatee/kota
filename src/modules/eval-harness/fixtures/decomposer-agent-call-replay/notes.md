# decomposer-agent-call-replay fixture

End-to-end replay of decomposer's `decompose` agent step through the
eval-harness replay adapter. The fixture regression-gates the
`shouldDecompose: true` branch identified as uncovered in
`src/modules/eval-harness/fixtures/uncovered/notes.md`.

## Shape

- `initial/` seeds a failed-builder run with `errorKind: step-timeout` and the
  immutable task identity carried by the builder's original
  `autonomy.queue.available` trigger. The matching task remains actionable in
  `open` at the same path with the same semantic digest. No workflow-owned
  claim file participates in ownership. The fixture subprocess runs
  `kota workflow exec decomposer` with the
  builder-failure trigger payload, so `assess-failure` resolves
  `shouldDecompose: true` and the `decompose` agent step fires.
- `recordings/decompose.json` carries the recorded response envelope
  and a typed decomposition plan. Its `fileOperations` is empty because
  the production `apply-decomposition` code step owns task creation,
  dependency wiring, parent retirement, and commit-message creation
  through the canonical task APIs.
- The plan produces the two task ids asserted by the fixture and
  includes every section required by current open-task validation.
- `recordings/review-decomposition.json` approves the plan after comparing it
  with the canonical parent markdown exposed by `assess-failure`.

## Why this shape

The replay exercises trigger routing, assessment, typed planner and semantic
review output, deterministic task mutation, task queue validation, and
runtime-owned publication against the production workflow. Only the agent
harness is replaced, so a regression from failure attribution through
integrated subtask state fails without paying for a live model call.
