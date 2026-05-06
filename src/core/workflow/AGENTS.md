# Workflow Runtime

This directory contains the autonomous workflow runtime, validation, registry, and persisted run state.

- Keep workflow protocols strict, restart-safe, and easy to reason about.
- Put top-level autonomous execution semantics here, not in prompts or scheduler side channels.
- Workflows are the single automation surface. Hooks, cron-like jobs, standing
  orders, inbound webhooks, and autonomous loops should be expressed as typed
  workflow definitions rather than parallel engines.
- Keep trigger semantics narrow and explicit. Prefer semantic events over
  workflow-name inventories or implicit routing metadata.
- Runtime rails such as validation, retries, timeout handling, dispatch windows,
  output truncation, and notification suppression belong in typed code and tests.
  Do not duplicate their exact fields, enum values, or event names in docs.
- Agent steps should receive a thin runtime envelope. Expose prior step output
  only when the agent cannot cheaply recover the information through normal repo
  context and tools.

## Per-Concern Validation Split

`validation.ts` is a thin orchestrator that delegates each rule family to a
per-concern sibling: `validation-step-dispatch.ts` (per-step-type fan-out),
`validation-shape.ts` (definition path, name uniqueness, moduleRoot,
non-empty triggers/steps, `defaultAutonomyMode`), `validation-step-ids.ts`
(step-id uniqueness across nested step trees), `validation-restart.ts`
(restart-step constraints), `validation-trigger-references.ts` (trigger-
step self-reference plus unknown-workflow and `waitFor: "queued"`
warnings; complements `validation-trigger.ts` which validates the
trigger-event shape itself), and `validation-assembly.ts` (per-definition
`webhookRateLimit`, `notify`, `tags`, validated `triggers` including the
`workflow.completed` self-loop check, and the `runtime.recovered` ↔
`recoveryCapable` consistency check). New validation rules belong in the
matching sibling; do not regrow `validation.ts` past the orchestrator
boundary.

## Per-Concern Run-Store Split

Run-store helpers split into per-concern siblings: `run-io.ts` owns the
filesystem/JSON primitives and `formatRunId`,
`run-store-state-schema.ts` owns the runtime-state type guards and
`assertWorkflow*` validators, `run-store-legacy-migration.ts` owns the
pre-`{lastStarted, lastCompletion}` migration (kept isolated so its
eventual removal does not touch the schema), and `run-store-snapshot.ts`
owns `STATE_FILE`, `WorkflowSnapshot`, `RepairSummary`,
`buildWorkflowSnapshot`, and `extractRepairSummary`. New run-store
behavior belongs in the matching sibling; do not reintroduce a single
`run-store-helpers.ts` aggregator.

## Per-Lifecycle-Phase Runtime Split

`runtime.ts` is a thin `WorkflowRuntime` orchestrator that owns a single
`WorkflowRuntimeContext` and delegates each lifecycle phase to a sibling
file (lifecycle, definitions, runs control, events, recovery, dispatch).
The orchestrator keeps construction, the shared context container, and
forwarding methods only. All non-trivial lifecycle logic lives in the
per-phase sibling files. Each phase declares its own input interface
extending the dispatch state, so helpers can call across phases without
per-call type assertions. New runtime behavior belongs in the matching
phase file; do not grow `runtime.ts` past the orchestrator boundary.

## Pausable Await-Event Steps

A workflow step with `type: "await-event"` suspends on a typed bus event,
matched by a `(matchField, matchValue)` pair on the event payload. The
suspension survives a daemon restart:

- The step writes a suspension record at
  `.kota/runs/<run-id>/awaits/<step-id>.json` before it begins waiting and
  subscribes through `EventBus.on`. There is no separate event router.
- On match (live), the executor writes a sibling
  `<step-id>.delivered.json`, then resolves with the captured payload and
  removes both files. Suspension cleanup is durable across the resolve
  boundary so a crash mid-record can still recover.
- On daemon startup, `installAwaitResumers` scans every persisted
  suspension. For each it either queues a resume run immediately (delivery
  sibling present, or the deadline already passed during the gap) or
  registers a fresh one-shot bus listener plus a deadline race. The first
  match (or timeout) tears down the other and queues a resume.
- Resume runs carry the captured payloads under
  `trigger.payload.awaitEventPayloads[stepId]`. The await-event executor
  short-circuits when that key is present, so the workflow continues with
  the matched event payload (or a typed `{ kind: "timeout" }` shape) as
  the step's output.

Replay safety lives in the executor's `settled` flag and the resume
listener's `fired` flag — duplicate deliveries with the same id are dropped
on the receive side. Persisted-await files referencing a missing workflow
or step are removed and logged so a stale candidate is visible to
operators rather than silently retried.

Await-event steps bypass the default step hang rail
(`DEFAULT_STEP_TIMEOUT_MS`) when no explicit `timeoutMs` is set, because
operator-loop waits can legitimately exceed it. The protocol-level
deadline is `awaitTimeoutMs`, which produces the typed timeout output;
`timeoutMs` (when explicitly set) still applies as a hard hang rail.

External producers can deliver an event during a daemon-down gap by
writing the delivery sibling directly. The on-disk shape is
`{ kind: "event", deliveredAt, event, payload }` for a captured match or
`{ kind: "timeout", deliveredAt, event, awaitTimeoutMs }` for a fired
deadline.

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
