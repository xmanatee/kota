# Workflow Runtime

Owns workflow definitions, validation, durable run state, execution, repair,
and publication.

## Run Ownership

- Every workflow definition must declare repository access as `none`, `read`,
  or `write`. A writer also declares integration validation. Logical resource
  resolvers express domain exclusivity without workflow-specific locks.
- `RunStateDatabase` is the only durable queue and the authority for admission,
  run attempts, logical resources, process identities, external effects, and
  terminal publications. Scope-owned durable state uses its revisioned
  SQLite API; runs stage compare-and-set mutations that commit atomically with
  success publications. `WorkflowRunStore` and run artifacts are evidence, not
  queue, summary, lease, or shared state. Persistent dispatch pause is project
  state in that database. Agent backoff is scope state so one scope cannot halt
  or resume a sibling. Only the daemon database composition root migrates
  schema or disposes known obsolete operational files; offline readers are
  explicit and read-only, and standalone hosts never perform cutover work.
- `RunCoordinator` owns daemon-wide capacity, global and project admission
  pause, cancellation, and child waits. Waiting parents release capacity and
  reacquire it before continuing.
- `RunLifecycle` owns sandbox creation/adoption, resource allocation, workflow
  execution, writer finalization, restart reconciliation, and cleanup.
- `IntegrationQueue` is the only writer publication path. It rebases against
  the current canonical head, validates, acquires the repository integration
  resource, runs any workflow-declared semantic invariant against that exact
  reconciled/canonical snapshot, checks both trees again, and publishes with a
  fast-forward merge. Invariant rejection preserves the writer for attention.
- Conflict and validator repair use a bounded AI continuation. Screened
  diagnostics, conflict-path write scope, Git mutation denial, cancellation,
  and no-progress fingerprints are runtime rails; staging, rebase continuation,
  commit, and publication remain runtime-owned.
- `WorkflowQueueManager` is a trigger-admission adapter over durable run state.
  Do not add an in-memory or JSON queue, task-claim file, workflow-owned
  worktree, merge gate, process registry, port lease, or recovery side channel.

## Definitions And Steps

- Workflows are the only automation runtime surface. `defineAutomation` and
  `defineHook` must compile to ordinary definitions before validation,
  scheduling, storage, approvals, or APIs observe them.
- Keep trigger semantics narrow and explicit. Prefer semantic events over
  workflow-name inventories, synthetic recovery events, or implicit routing.
- Keep validation, retries, timeouts, dispatch windows, truncation, and
  notification suppression in typed code. Test their observable behavior
  without copying configuration catalogs or private runtime phases.
- Cross-run retries replay ordinary completed steps. `rerunOnRetry` marks
  current-run work that must execute again with following steps; explicit
  resume remains a separate operator checkpoint.
- Hard timeouts cap wall-clock execution. Idle timeouts cap gaps between trusted
  code heartbeats or typed agent progress messages.
- Agent steps receive a thin runtime envelope. Expose prior output only when
  normal repository context and tools cannot recover it cheaply.
- `WorkflowStepContext.stateDir` is the owning directory scope's `.kota`
  root. The event journal may be daemon-wide and must not redirect scope-local
  run, task, owner-state, or workflow-state inspection to the default scope.
- Repository writers cannot approve, await owner input, restart, trigger other
  workflows, or call non-read tools before integration. Writer agent and nested
  judge contracts have owner questions disabled. Use declarative emits for
  outbox-staged publication and `repository: none` follow-ups for external
  effects after integration.
- Repair accounting includes initial and repair token usage, including terminal
  failures.
- Every workflow-owned harness call crosses its scope's agent-backoff gate,
  including agent steps, repair iterations, and code-step judges. Classified
  provider failures activate it at that boundary, cancel other in-flight agent
  calls in that scope, and deny later calls before harness launch while
  deterministic dispatch remains eligible. Autonomous daemon one-shot
  judgments explicitly join the selected scope's gate before sending. Shared
  provider incidents persist stable reason codes; raw harness and provider
  diagnostics remain in authenticated session or retained run evidence.
  Quality pauses retain any active provider recovery horizon, and an operator
  retry clears only the quality pause while that provider incident remains
  active.

## Durable Waits

- `await-event` suspends a run on a typed event match and persists enough state
  to resume after restart. Live delivery and timeout race once; duplicate
  delivery is ignored.
- `askOwnerSteps` composes `ask`, `wait`, and `consume` over that primitive.
  Owner questions, answers, dismissal, expiry, and timeout remain typed daemon
  state rather than an open agent tool loop.
- Await steps without an explicit step timeout may exceed the default hang rail;
  `awaitTimeoutMs` is the protocol deadline. An explicit `timeoutMs` still caps
  active runtime.

## Typed Code Steps

Use `typedCodeStep<T>` when downstream steps consume code-step output. Its
decoder validates fresh and persisted values; `output` is optional and
`outputRequired` fails when the step did not produce a value. Untyped code
steps remain appropriate for scalar or unread output.
