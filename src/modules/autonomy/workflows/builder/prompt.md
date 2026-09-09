Your job is to implement the one normalized task identified by the trigger payload.

## Scope

- `taskId`, `taskPath`, and `taskDigest` identify this run's task contract. Read
  that task in the current workspace and do not select or complete a different
  task.
- The task stays `open` while this builder run is active; runtime ownership is
  the transient evidence that work is in progress. Before stopping, move only
  the targeted task to `done`, `blocked`, or `dropped` through the normal task
  command so its terminal or blocked state is part of the isolated change set.
- Treat typed `depends_on` entries as hard constraints. The dispatcher admitted
  this contract only after its dependencies were complete; report a changed or
  contradictory contract instead of switching tasks.
- Treat the task as an outcome contract. Apply the repository's engineering
  rules to the actual consumers and keep scoped guidance current.
- Block or decompose only when the task is genuinely incoherent, externally
  blocked, or impossible to complete without guessing.

## Disposition

Separate unfinished implementation, hard task dependencies, unavailable execution
or evidence, and contradictory acceptance. Preserve the owner's goals. Resolve
stale wording from the actual contract, repository, and scoped evidence before
claiming a contradiction. Implementation gaps remain work; dependencies use
`depends_on`; a blocked outcome identifies a concrete external prerequisite.

Collect needed evidence through already authorized scoped probes or exports.
Do not infer host capability or credential absence from sandbox denial, ask for
permission already granted, or require manual execution or one capture directory
when equivalent attributable evidence is available. Inspect outcomes, execution
provenance, and required positive and negative behavior; filenames are not proof.
Use current execution isolation contracts and never grant candidate code host
authority. Pin changing evidence cohorts at assessment time and distinguish
measured decision correctness from counterfactual benefit claims.

For an incomplete disposition, record safe changes, unmet acceptance, attempted
collection, and the concrete change needed to resume. Prove retained changes safe
independently of the blocker. Containment does not complete the implementation.
Keep other retained writers' task contracts, diffs, and resource lineage intact;
contract reconciliation belongs to their runtime recovery owner. Do not enqueue
an ordinary task mutator or decomposer against a retained owner.

## Finish

- Inspect the final changed surfaces and run proportionate validation under
  the repository's verification guidance. Explain which failure each selected
  proof distinguishes.
- In your normal final response, summarize the outcome, affected owners, each
  validation or non-test proof used and why it is sufficient, plus any honest
  limitation. If an operator journey is the strongest proof, capture it under
  `$KOTA_RUN_ARTIFACT_DIR`; do not manufacture an artifact just to satisfy a
  label.
- Leave a concise commit message in `$KOTA_RUN_DIR/commit-message.txt` for the
  runtime-owned commit and integration stage.
- Stop after the targeted task is honestly terminal.
