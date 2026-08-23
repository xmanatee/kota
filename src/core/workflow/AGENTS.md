# Workflow Runtime
Owns workflow definitions, validation, execution, repair loops, and persisted run state.

- Put top-level autonomous execution semantics here, not in prompts or scheduler side channels.
- Workflows are the only automation surface; all automation compiles to them.
- `automation` is authoring; `workflow` is the durable triggered runtime form.
- `defineAutomation` / `defineHook` must return ordinary workflow definitions before validation, scheduling, approvals, storage, or APIs observe them.
- Agent harness lifecycle hooks are internal, not operator-authored hooks.
- Keep trigger semantics narrow and explicit. Prefer semantic events over workflow-name inventories or implicit routing metadata.
- `buildOperatorQueuedRun` owns operator-trigger construction for every client
  path. Retry and replay preserve the source event and schema; lineage belongs
  in payload metadata and must not replace the semantic event.
- Keep validation, retries, timeouts, dispatch windows, truncation, and
  notification suppression in typed code and tests, not field catalogs in docs.
- Cross-run retries replay ordinary completed steps. A successful top-level code
  step marked `rerunOnRetry` re-executes with every following step because its
  output or mutation is current-run-owned; workspace or runtime resource updates
  still restart because their context is source-run-owned; explicit resume is a separate operator checkpoint.
- Dirty recovery pauses dispatch and prepends recovery work while preserving durable queued runs, keyed redrives, and pending work across restarts.
- On reload, revalidate pending automatic work against the enabled definition,
  payload contract, and admission watermark; preserve explicit control/resume work.
- A restart step is terminal. `allowPostRestartEmits` permits only pure emit
  handoffs afterward so dispatch pauses before consumers queue; other work is invalid.
- Hard step timeouts cap wall-clock runtime. Idle-progress timeouts cap gaps
  between trusted progress signals: code heartbeats or typed agent messages.
- Agent steps receive a thin runtime envelope; expose prior output only when normal repo context and tools cannot recover it cheaply.
- Repair-loop output accumulates initial and repair token usage, including on terminal failure, so run accounting reflects consumed quota.

## Per-Concern Validation Split
`validation.ts` only orchestrates; put rules in the sibling owning dispatch,
definition shape/ids, restarts, triggers, or assembly. Do not regrow it.
Agent leaves, judge checks, and agent-launching code steps use the launch resolver
to validate resolved static adapter contracts at definition load and launch;
dynamic readiness and policy remain launch-time state.

## Per-Concern Run-Store Split
Run-store helpers are split by concern: filesystem/JSON IO, runtime-state
schema, isolated legacy migration, and snapshot/repair-summary shaping. New
run-store behavior belongs in the matching sibling; do not reintroduce a
single `run-store-helpers.ts` aggregator.

## Per-Lifecycle-Phase Runtime Split

`runtime.ts` is a thin `WorkflowRuntime` orchestrator around one
`WorkflowRuntimeContext`. Lifecycle, definitions, runs control, events,
recovery, and dispatch logic live in per-phase siblings with their own input
interfaces. Keep construction, the context container, and forwarding methods
in the orchestrator; put new runtime behavior in the matching phase file.

## Pausable Await-Event Steps

A workflow step with `type: "await-event"` suspends on a typed bus event,
matched by a `(matchField, matchValue)` pair on the event payload. The
suspension survives a daemon restart:

- The step writes `.kota/runs/<run-id>/awaits/<step-id>.json` before waiting
  and subscribes through `EventBus.on`. There is no separate event router.
- On match (live), the executor writes a sibling
  `<step-id>.delivered.json`, then resolves with the captured payload and
  removes both files. Suspension cleanup is durable across the resolve
  boundary so a crash mid-record can still recover.
- On daemon startup, `installAwaitResumers` scans every persisted
  suspension. For each it either queues a resume run immediately (delivery
  sibling present, or the deadline already passed during the gap) or
  registers a fresh one-shot bus listener plus a deadline race. The first
  match (or timeout) tears down the other and queues a resume.
- Resume runs carry captured payloads under
  `trigger.payload.awaitEventPayloads[stepId]`; the executor short-circuits
  there and returns the matched event payload or typed timeout output.

Replay safety lives in the executor's `settled` flag and resume listener's
`fired` flag; duplicate deliveries with the same id are dropped on receive.
Persisted awaits for missing workflows or steps are removed and logged.

Await-event steps bypass the default step hang rail
(`DEFAULT_STEP_TIMEOUT_MS`) when no explicit `timeoutMs` is set, because
operator-loop waits can legitimately exceed it. The protocol-level
deadline is `awaitTimeoutMs`, which produces the typed timeout output;
`timeoutMs` (when explicitly set) still applies as an active-runtime hang rail;
host suspension does not consume it.

External producers bridge daemon-down gaps by writing the delivery sibling with
the same event or timeout shape.

## Ask-Owner Step Pattern

`askOwnerSteps` (in `ask-owner-step.ts`) composes the pausable
await-event primitive into a three-step recipe — `ask`, `wait`,
`consume` — that escalates a high-stakes decision to the repo owner
without holding the agent's tool loop open. Workflows splice the
returned steps into their definition.

- `ask` enqueues the question on `OwnerQuestionQueue`. Notification
  modules already subscribe to `owner.question.asked` and forward the
  question to operators.
- `wait` is an `await-event` step on `owner.question.resolved` matched
  by `id`. The suspension persists to disk so a daemon restart mid-wait
  resumes the run via `installAwaitResumers`.
- `consume` reads the queue's terminal state and runs the structural
  injection detector (`#core/util/injection-detector.js`) over the
  operator's answer, returning a typed `AwaitedOwnerOutcome`
  discriminated union: `answered` (with optional banner when the
  detector flags the payload), `dismissed`, `expired`, or `timeout`.

Downstream steps consume the outcome via `owner.consume.output(ctx)` or
read the await output from the resume run's trigger envelope under
`trigger.payload.awaitEventPayloads[<wait-step-id>]`.

## Typed Code Step Pattern

Use `typedCodeStep<T>` from `types.ts` when a code step's output is consumed
by downstream steps or `when` predicates. It adds two accessors typed as
`T`: `output(ctx)` returns `T | undefined` (use when the caller gates with
`?.`) and `outputRequired(ctx)` returns `T` and throws if the step was
skipped or has not yet run.

A `validate` decoder is required. It runs once after `run()` (catching
shape drift on fresh runs) and again on every `output(ctx)` access
(catching persisted/resumed values that no longer match `T`). On rejection
the runtime throws `WorkflowStepOutputValidationError` with the offending
step id and surface (`run` vs `persisted`). `expectStructuredOutput` and
`expectArrayOutput` cover the common cases; supply a custom function for
anything more involved.

Untyped `WorkflowCodeStepInput` (no `validate`, no typed accessor) is
still valid for scalar or unread outputs — adopt the typed pattern only
when downstream type safety is needed.
