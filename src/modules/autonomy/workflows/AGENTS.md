# Workflows

Autonomy workflows and their co-located prompts live here.

## Definition Contract

- Keep each workflow cohesive, typed, and role-focused. `workflow.ts` is the
  source of truth and the autonomy module is the only registry.
- Declare repository access on every workflow. Writers also declare integration
  validation; use logical resources for semantic exclusivity such as one task.
  When canonical domain identity must remain unchanged from admission through
  publication, declare a pure `integration.postReconcile` invariant. The shared
  integration rail runs it after rebase under publication serialization.
- Definitions describe semantic work. `RunStateDatabase`, `RunCoordinator`,
  `RunLifecycle`, and `IntegrationQueue` own queueing, capacity, isolation,
  resources, processes, recovery, commit, validation, and publication.
- Do not add workflow-specific claims, worktrees, branches, staging helpers,
  merge gates, port leases, terminal finalizers, or synthetic recovery triggers.
- Shared cadence and watermark values use the runtime state API. Workflows read
  a revision and stage compare-and-set; they do not write canonical state files
  or publish dependent events before run success.
- Every agent step declares autonomy explicitly or inherits
  `defaultAutonomyMode`. Agent write scope is enforced inside the run sandbox;
  prompts should describe the role, not restate runtime rails.
- Agents write declared evidence under `$KOTA_RUN_DIR` and
  `$KOTA_RUN_ARTIFACT_DIR`. They do not stage, commit, rebase, or publish Git
  changes.

## Routing

Only `dispatcher` listens to `runtime.idle`. Other workflows trigger on typed
events describing domain state. A `workflow.completed` trigger must exclude its
own completion; validation rejects self-trigger loops.

Dispatcher emits queue-shape events rather than a fixed workflow graph:

- `autonomy.queue.available` identifies one dependency-clear `ready` or `doing`
  task. Its immutable digest and `taskId` bind builder to `task:<taskId>`.
- `autonomy.queue.needs-promotion` means no actionable task exists and at least
  one dependency-clear backlog task can enter `ready`.
- `autonomy.queue.empty` means no dispatchable task or known dependency blocker
  exists; explorer may look for new work.
- `autonomy.queue.thin` reports a small dispatchable tail without treating
  anchors or dependency-waiting tasks as available work.
- `autonomy.blocked-research.attemptable` identifies blocked research that the
  current runtime can retry.

Builder never consumes backlog directly; backlog promotion records why work was
selected before a targeted builder event is emitted.

## Repair And Tests

- Repair checks validate without editing or staging. Use typed code checks for
  objective invariants and agent judgment for architecture or intent.
- Give each decision one owning test layer. Workflow tests cover semantic
  routing, predicates, resource binding, and outcomes; shared runtime tests own
  durable admission, capacity, sandbox, process/effect recovery, integration,
  and publication behavior.
- Do not freeze config catalogs, helper call order, filenames, private phases,
  or retired concurrency/recovery mechanics in tests.
