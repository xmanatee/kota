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

Native authorization also transports bounded calls to explicitly opted-in module
tools. Invocation authority comes from the hosting agent context and current run
attempt, never request fields. The shared tool pipeline still checks scope and
effects. Calls drain before the native authorization lifetime closes.
Blocking workers synchronously acknowledge durable process/resource registration
before proceeding; cancellation starts independent cleanup before waiting for
worker exit. Cleanup failures retain the invocation while other owners are drained;
return requires worker exit, confirmed client termination, and a final resource
removal sweep after those producers have stopped. Restart recovery uses the same process registry for idempotent resource removal and
preserves ownership when removal cannot be confirmed.
