# Workflow Runtime

This directory contains the autonomous workflow runtime, validation, registry, and persisted run state.

- Keep workflow protocols strict, restart-safe, and easy to reason about.
- Put top-level autonomous execution semantics here, not in prompts or scheduler side channels.

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
