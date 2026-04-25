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

## Internal Subdomains

- `steps/` — step execution strategies and step context construction.
- `step-validators/` — per-step-type definition validation.
- `testing/` — `WorkflowTestHarness` for unit-testing workflow definitions.
- Runtime orchestration: `runtime.ts`, `runtime-dispatch.ts`,
  `runtime-config.ts`, `runtime-signals.ts`.
- Run lifecycle: `run-executor*.ts`, `run-store*.ts`, `run-io.ts`,
  `run-types.ts`, `active-run-handle.ts`.
- Definition validation: `validation*.ts`, `payload-validator.ts`.
- Scheduling: `cron.ts`, `dispatch-window.ts`, `schedule-triggers.ts`,
  `watch-triggers.ts`.
- Repair and resilience: `repair-loop.ts`, `agent-backoff.ts`,
  `failure-alert.ts`.
- Shared types and events: `types.ts`, `event-payloads.ts`.

## Pausable Await-Event Steps

A workflow step with `type: "await-event"` suspends on a typed bus event,
matched by a `(matchField, matchValue)` pair on the event payload. The
suspension survives a daemon restart:

- The step writes a suspension record at
  `.kota/runs/<run-id>/awaits/<step-id>.json` before it begins waiting and
  subscribes to the bus through `EventBus.on`. There is no separate event
  router.
- On match (live), the executor writes a sibling
  `<step-id>.delivered.json`, then resolves with the captured event payload
  and removes both files. Suspension cleanup is durable across the resolve
  boundary so a crash mid-record can still recover.
- On daemon startup, `installAwaitResumers` scans every persisted
  suspension. For each it either queues a resume run immediately (delivery
  sibling present, or the deadline already passed during the gap) or
  registers a fresh one-shot bus listener plus a deadline race. The first
  match (or timeout) tears down the other, queues a resume, and lets
  `maybeStartNext` dispatch it through the existing run-resume path.
- Resume runs carry the captured payloads under
  `trigger.payload.awaitEventPayloads[stepId]`. The await-event executor
  short-circuits when that key is present, so the workflow continues with
  the matched event payload (or a typed `{ kind: "timeout" }` shape) as
  the step's output.

Replay safety lives in the executor's `settled` flag and the resume
listener's `fired` flag — duplicate deliveries with the same id are dropped
on the receive side. Persisted-await files referencing a missing workflow
or missing step are removed and logged so a stale recovery candidate is
visible to operators rather than silently retried.

Await-event steps bypass the default step hang rail
(`DEFAULT_STEP_TIMEOUT_MS`) when no explicit `timeoutMs` is set, because
operator-loop waits can legitimately exceed it. The protocol-level
deadline is `awaitTimeoutMs`, which produces the typed timeout output;
`timeoutMs` (when explicitly set) still applies as a hard hang rail that
fails the step.

External producers can deliver an event during a daemon-down gap by
writing the delivery sibling directly. The on-disk shape is
`{ kind: "event", deliveredAt, event, payload }` for a captured match or
`{ kind: "timeout", deliveredAt, event, awaitTimeoutMs }` for a fired
deadline.

## Typed Code Step Pattern

Use `typedCodeStep<T>` from `types.ts` when a code step's output is consumed by downstream
steps or `when` predicates. It returns a `TypedCodeStepInput<T>` that is assignable to any
`WorkflowCodeStepInput` slot and adds an `output(context)` accessor typed as `T`:

```ts
import { typedCodeStep } from "../workflow/types.js";

const myStep = typedCodeStep<MyOutputType>({
  id: "my-step",
  type: "code",
  run: (): MyOutputType => ({ ... }),
});

// Use myStep directly in the steps array.
// Downstream steps access the output without casts:
when: (ctx) => myStep.output(ctx).someField > 0,
```

The runtime representation is unchanged (`stepOutputs` remains `Record<string, unknown>`).
Untyped code steps are still valid — only adopt this pattern when downstream type safety
is needed.
