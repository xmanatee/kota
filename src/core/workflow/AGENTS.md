# Workflow Runtime

Owns workflow definitions, validation, durable run state, execution, repair,
and publication.

## Run Ownership

- Definitions declare repository access (`none`, `read`, or `write`); writers
  also declare integration validation. Logical resources express domain
  exclusivity without workflow-specific locks.
- `RunStateDatabase` owns durable admission, attempts, resources, processes,
  external effects, and terminal publications. Scope state uses its revisioned
  SQLite API; staged compare-and-set mutations commit atomically with success.
  Project dispatch pause and scope agent backoff live there, with sibling scopes
  isolated. `WorkflowRunStore` and artifacts are evidence, never a second queue
  or shared state store. Only daemon database composition migrates schema and
  removes obsolete operational files; offline readers are explicit and read-only.
- `RunCoordinator` owns capacity, admission pause, cancellation, and child waits.
  Waiting parents release capacity and reacquire it before continuing. Retained
  recovery assessments inherit coordinator cancellation and join its scope and
  shutdown drains without taking execution capacity.
- `RunLifecycle` owns sandbox creation/adoption, resource allocation, execution,
  writer finalization, restart reconciliation, and cleanup.
  Automatic recovery preserves ambiguous missing sandboxes. Explicit cancellation
  may release a missing checkout with no remaining branch or Git registration,
  preserving residual runtime files with the run artifacts; it never completes the task.
- `IntegrationQueue` alone publishes writers: rebase onto canonical head,
  validate, acquire the integration resource, run domain invariants against
  that exact snapshot with fresh scope-state and scope-filtered ownership
  readers, recheck both trees, then fast-forward. Rejection retains the writer.
- Conflict and validator repair use bounded AI continuation with screened
  diagnostics, conflict-path write scope, Git mutation denial, cancellation,
  and no-progress fingerprints. Runtime owns staging, commits, rebase, and
  publication. Each repair invocation retains distinct timestamped evidence
  under its original run. Stream only when supported; always retain returned
  results, verification summaries, and measured usage, including on errors or
  cancellation. Agent success still requires validation and publication.
- Workflow owners supply repair continuation's domain contract and judgment;
  core observes semantic boundaries, check evidence, queue revisions, and
  same-scope workspace changes, then owns durable yield/resume. One judgment
  covers a boundary until unresolved attempts grow geometrically, failures
  strictly expand, or diff scope materially expands; volatile churn alone
  never creates a reviewer cadence. Resumable harnesses establish their session
  before checkpoint polling. Preserved runs retain workspaces and resources,
  release capacity, and defer to actually runnable higher-priority work. Blocked,
  deferred or unadmitted work does not become a hard completion dependency.
- Nested critic, semantic-gate, and continuation judges are filesystem
  read-only; they inspect unpublished work without becoming mutation owners.
- Decomposition terminally classifies the writer through its failed-run
  consumer. The domain module reviews and changes work; core never creates
  child tasks from free-form text.
- `WorkflowQueueManager` adapts triggers to durable admission. Do not add
  parallel queues, task-claim files, workflow-owned worktrees, merge gates,
  process registries, port leases, or recovery side channels.
- Suspended runs retain exclusive resources. Reconciliation and resumption
  enter through their recovery owner; ordinary mutators cannot revise their
  contract. Definitions may assess relevant changes before retained execution;
  runtime atomically reconciles trigger, recovery revision, and dispatch
  identity while preserving resources. Publication journals resume integration
  recovery instead of restarting business execution.
- Discovery-based resource resolvers select work at admission and reuse that
  admitted snapshot on restoration. Queue changes, including the writer's own
  publication, cannot strand publication or cleanup recovery.
- A persisted sandbox that disappears keeps its ownership until Git-backed
  cleanup reconciliation or the runtime publication journal establishes its
  disposition. Missing files and empty historical diffs are not cleanup evidence.
- `ctx.runEvidence` provides immutable, scope-filtered observations. Investigators
  receive redacted exports and unavailable diagnostics; database handles and
  host control authority stay in runtime.
- Daemon startup may repair malformed authority-critical or recovered metadata
  only when durable run, `workflow.json`, and `trigger.json` agree. Preserve the
  malformed source; disagreement fails closed. Other terminal history remains
  quarantinable. Dead-letter disposition needs run-specific repair evidence and
  a later successful consumer. Standalone and inspection paths stay read-only.
- Native writer authorization rechecks run, attempt, daemon epoch, and workspace
  per mutation. Sandboxed commands receive fresh boolean responses, never raw
  databases. Request/reply files are transient invocation transport, not durable
  state or reusable approvals.

## Definitions And Steps

- `defineAutomation` and `defineHook` compile to ordinary workflows before
  validation, scheduling, storage, approvals, or APIs observe them.
- Prefer explicit semantic triggers over workflow-name inventories, synthetic
  recovery events, or implicit routing.
- Validation, retries, timeouts, dispatch windows, truncation, and notification
  suppression belong in typed code. Test behavior, not copied catalogs or
  private runtime phases.
- Cross-run retries replay ordinary completed steps. `rerunOnRetry` repeats
  current-run work and following steps; explicit resume is a separate checkpoint.
- Hard timeouts cap runtime; idle timeouts cap gaps between trusted heartbeats
  or typed agent progress messages.
- Shared active timing excludes suspension only from independent OS clock or
  power observations. Event-loop starvation remains elapsed runtime; timer
  lateness alone cannot extend a deadline.
- Agent envelopes stay thin. Supply prior output only when repository context
  and tools cannot recover it cheaply.
- `WorkflowStepContext.stateDir` is the owning scope's `.kota` artifact root;
  `runtimeStateDir` locates the authoritative database. A daemon-wide event
  journal cannot redirect scope-local run, task, owner, or workflow inspection.
- Before integration, repository writers cannot approve, await owner input,
  restart, trigger workflows, or call non-read tools. Writer agents and nested
  judges disable owner questions. Declarative emits stage outbox publication;
  synchronous `finalize` commits domain state and emits with success after
  lifecycle cleanup. Local effects must be idempotent per durable run. Use
  `repository: none` follow-ups only for external effects after integration.
- Account for initial and repair token usage, including terminal failures.
- Every workflow harness call and autonomous daemon judgment joins its scope's
  agent-backoff gate. Classified provider failures cancel in-flight agents and
  deny new launches while deterministic dispatch remains eligible. Persist
  stable incident reasons; retain raw diagnostics only in authenticated session
  or run evidence. Quality pauses preserve provider recovery horizons; operator
  retry clears only the quality pause, never an active provider incident.

## Durable Waits

- `await-event` persists a typed event wait across restart. Delivery and timeout
  settle once; duplicate delivery is ignored.
- `askOwnerSteps` composes ask, wait, and consume. Questions, answers, dismissal,
  expiry, and timeout are typed daemon state, not an open agent loop.
- `awaitTimeoutMs` is the protocol deadline and may exceed the default hang
  rail. An explicit step `timeoutMs` still caps active runtime.

## Typed Code Steps

Use `typedCodeStep<T>` for consumed code-step output. Its decoder validates fresh
and persisted values; `output` is optional, while `outputRequired` rejects a
missing value. Untyped steps remain appropriate for scalar or unread output.
