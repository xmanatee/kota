# Workflows

Workflows are KOTA's single automation surface. Every recurring or reactive job —
hook-like reactions, heartbeats, standing orders, and scheduled maintenance —
should be expressed as a workflow, not as a parallel engine.

## Trigger Types

| Trigger | Field | When it fires |
|---|---|---|
| Event | `event: "workflow.completed"` | When the named bus event fires |
| Cron schedule | `schedule: "0 9 * * 1-5"` | On a 5-field cron expression |
| Interval | `intervalMs: 300_000` | Every N milliseconds |
| Idle | `event: "runtime.idle"` | When no workflow has run recently |

Add `filter` to narrow event triggers. Add `cooldownMs` to prevent back-to-back
runs on noisy events.

## Concurrency Model

Workflows run concurrently based on their step types, unless configured otherwise.

| Type | Default concurrency | Config field |
|---|---|---|
| Agent-step (any `type: "agent"` step) | 1 | `agentConcurrency` |
| Code-only (all steps are `type: "code"`) | 4 | `codeConcurrency` |
| Named group | 1 (serialized) | `concurrencyGroup` on the definition |

The runtime classifies each workflow at dispatch time. Agent-step workflows
queue behind `agentConcurrency`; code-only workflows run freely up to
`codeConcurrency`. Both limits are enforced simultaneously, so a code-only
workflow (e.g. an attention digest) can run while an agent workflow occupies
its slot.

Use `concurrencyGroup` to explicitly serialize two or more workflows that must
not overlap, regardless of their step types:

```typescript
const myWorkflow: WorkflowDefinitionInput = {
  name: "my-extension/heavy-job",
  concurrencyGroup: "my-extension/heavy",
  // ...
};
```

## Common Patterns

## Agent Step Contract

Workflow agent steps should receive a thin runtime envelope, not a curated
context pack. The runtime may inject:

- trigger details
- run identity and run directory
- explicitly exposed step outputs that the agent cannot recover itself

Everything else should stay discoverable by the agent through normal repo
surfaces and tools.

If a step output truly must be passed forward, mark that step with
`exposeOutputToAgent: true`. Keep this rare.

Built-in autonomy workflows should default to no `dailyBudgetUsd`. Use
preflight checks, backoff, repair loops, and better queue shaping before adding
hard spend caps to explorer, builder, or improver.

### Per-Run Cost Cap

`costLimitUsd` on a workflow definition limits total agent spend for a single run.
After each step, the executor checks the accumulated `totalCostUsd` across all
completed steps. If it exceeds the cap, the run fails immediately with a clear
error message and follows the normal failure path (`workflow.failure.alert` emitted).

```typescript
const myWorkflow: WorkflowDefinitionInput = {
  name: "my-extension/bounded-job",
  costLimitUsd: 0.50,   // fail if a single run spends more than $0.50
  // ...
};
```

The global `dailyBudgetUsd` and the per-run `costLimitUsd` are independent. Omit
`costLimitUsd` to allow unlimited spend per run.

### Agent Step Fields

`type: "agent"` steps accept the following fields beyond the common step fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agentName` | `string` | — | Name of a registered `AgentDef`. Provides `promptPath`, `model`, `permissionMode`, and `settingSources` as defaults. |
| `promptPath` | `string` | — | Path to the prompt markdown file (relative to project root). Required when `agentName` is not set. |
| `model` | `string` | config default | Model to use for this step. Overrides `agentName` model default. |
| `maxTurns` | `number` | unlimited | Maximum agent turns before the step is interrupted. |
| `maxBudgetUsd` | `number` | — | Per-step spend cap in USD. |
| `thinkingEnabled` | `boolean` | `false` | Enable extended thinking (Claude reasons before responding). |
| `thinkingBudget` | `number` | `10000` | Token budget for thinking when `thinkingEnabled` is `true`. Minimum 1024. |
| `permissionMode` | `SDKPermissionMode` | `"bypassPermissions"` | Tool permission mode. |
| `allowedTools` | `string[]` | — | Restrict available tools to this list. |
| `disallowedTools` | `string[]` | — | Exclude these tools. |

```typescript
steps: [
  {
    id: "analyze",
    type: "agent",
    promptPath: "src/workflows/my-workflow/prompt.md",
    model: "claude-opus-4-6",
    thinkingEnabled: true,
    thinkingBudget: 15000,
    maxTurns: 30,
  },
]
```

Extended thinking is off by default. Enable it on steps where deeper reasoning
improves output quality (e.g., complex planning or architecture steps). It increases
cost and latency proportionally to the token budget.

### Hook-like reaction

React to a file change or a workflow completion:

```typescript
triggers: [
  { event: "workflow.completed", filter: { workflow: "builder", status: "success" } },
]
```

Any event on the internal bus can be a trigger. The bus emits `workflow.started`,
`workflow.completed`, `workflow.step.completed`, `file.changed`, and more.
See `src/event-bus.ts` for the full list.

### Heartbeat / standing order

Run a lightweight job whenever the system is idle:

```typescript
triggers: [
  { event: "runtime.idle", cooldownMs: 10 * 60 * 1000 },
]
```

`runtime.idle` fires every `idleIntervalMs` (default 30 s) when no workflow
is active. `cooldownMs` prevents running more than once per interval.

### Scheduled maintenance

Run on a fixed schedule:

```typescript
triggers: [
  { schedule: "0 3 * * *" },  // 3 am daily
]
```

Or at a fixed interval:

```typescript
triggers: [
  { intervalMs: 6 * 60 * 60 * 1000 },  // every 6 hours
]
```

## Contributing Workflows from Extensions

Extensions declare automation via `workflows` on `KotaExtension`. The runtime
registers and executes them alongside built-in workflows — same trigger model,
same observability, same run history.

```typescript
const myExtension: KotaExtension = {
  name: "my-extension",
  workflows: [
    {
      name: "my-extension/nightly-cleanup",
      description: "Remove stale artifacts every night",
      triggers: [{ schedule: "0 2 * * *" }],
      steps: [
        { id: "cleanup", type: "tool", tool: "shell", input: { command: "..." } },
      ],
    },
  ],
};
```

### Workflow Composition (trigger step)

A `type: "trigger"` step queues or synchronously awaits another workflow,
letting you compose multi-workflow pipelines without raw code steps or event
timing gymnastics.

```typescript
steps: [
  {
    id: "run-cleanup",
    type: "trigger",
    workflow: "my-extension/nightly-cleanup",
    waitFor: "completed",   // block until the triggered run finishes
    payload: {
      source: "{{trigger.payload.runId}}",   // interpolation supported
    },
  },
]
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `workflow` | `string` | — | Name of the workflow to queue. Must be registered and enabled. |
| `waitFor` | `"queued" \| "completed"` | `"queued"` | `"queued"` returns as soon as the run is accepted. `"completed"` blocks until the triggered run finishes (success or failure), respecting step-level `timeoutMs`. |
| `payload` | `object` | `{}` | Optional payload passed to the triggered run. Supports `{{trigger.payload.field}}` and `{{stepOutputs.stepId.field}}` interpolation. |

**Guards:** The validator rejects self-referential trigger steps at load time
(a workflow triggering itself is a hard error). Triggering an unregistered
workflow produces a warning at load time and a runtime error when the step runs.

### Parallel Step Groups

A `type: "parallel"` step runs code and agent steps concurrently within a single workflow run.

```typescript
steps: [
  {
    id: "fan-out",
    type: "parallel",
    maxParallelAgents: 2,
    steps: [
      {
        id: "analyze-frontend",
        type: "agent",
        promptPath: "src/workflows/my-workflow/prompt-frontend.md",
      },
      {
        id: "analyze-backend",
        type: "agent",
        promptPath: "src/workflows/my-workflow/prompt-backend.md",
      },
      {
        id: "check-config",
        type: "code",
        run: async (ctx) => ({ valid: true }),
      },
    ],
  },
]
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `steps` | `array` | — | Code and agent steps to run concurrently. Emit, restart, trigger, and nested parallel steps are not supported. |
| `when` | predicate | — | Condition evaluated before running the group. |
| `continueOnFailure` | `boolean` | `false` | If true, the parent workflow continues even if the group fails. |
| `maxParallelAgents` | `number` | no cap | Limits how many agent steps run simultaneously. Useful when the group has many agent steps and you want to avoid API contention. |

Individual agent steps inside a parallel group accept `timeoutMs` (defaults to 30 minutes per step). The group itself has no group-level timeout — set `timeoutMs` on individual steps to bound their runtime.

A child step failure causes the group to fail unless the child sets `continueOnFailure: true`. The group result output contains the inner step results as `{ steps: [...] }`.

## Testing Workflow Definitions

The `kota/testing` sub-path exports a `WorkflowTestHarness` that runs a workflow
definition in a lightweight in-process environment — no daemon, no real agent
session, no network required.

```ts
import { WorkflowTestHarness } from "kota/testing";
import myWorkflow from "./workflow.js";

test("skips deploy step when no changes", async () => {
  const harness = new WorkflowTestHarness(myWorkflow, {
    trigger: { event: "runtime.idle", payload: {} },
    stepMocks: {
      "check-changes": { output: { changed: false } },
      "deploy": {},  // agent steps require a mock; missing mocks throw
    },
  });
  const result = await harness.run();
  expect(result.steps["deploy"].status).toBe("skipped");
});
```

### How it works

| Step type | Harness behavior |
|-----------|-----------------|
| `code` | Calls the real `run` function with a mock `WorkflowStepContext`. |
| `agent` | Returns the value from `stepMocks[stepId]`. Throws if no mock is provided. |
| `tool` | Returns `stepMocks[stepId]` if provided; otherwise calls `contextOverrides.runTool`. |
| `emit` | Fires the `emit` closure; collected in `result.emitted`. |
| `restart` | Records `restartRequested` in the result; does not halt execution. |
| `trigger` | Returns `stepMocks[stepId]` if provided; otherwise calls `contextOverrides.triggerWorkflow`. |
| `parallel` | Runs child steps serially by default. Pass `parallel: true` for real concurrency. |

`when` predicates are evaluated with real predicate logic using the accumulated
step outputs from prior steps — the same way the production executor evaluates them.

### HarnessOptions

| Field | Type | Description |
|-------|------|-------------|
| `trigger` | `{ event, payload? }` | Trigger payload available as `ctx.trigger`. Defaults to `runtime.idle`. |
| `stepMocks` | `Record<string, unknown>` | Mock outputs for agent (required) and tool/trigger (optional) steps. |
| `runtimeState` | `{ completedRuns?, pendingRuns?, workflows? }` | State returned by `ctx.readRuntimeState()`. |
| `contextOverrides` | `{ runTool?, readPrompt?, triggerWorkflow? }` | Override individual context methods for code-step testing. |
| `parallel` | `boolean` | Run parallel groups truly in parallel. Default: `false`. |

### HarnessRunResult

```ts
type HarnessRunResult = {
  status: "success" | "failed";
  steps: Record<string, HarnessStepResult>;
  error?: string;
  emitted: Array<{ event: string; payload: Record<string, unknown> }>;
  restartRequested?: string;
};

type HarnessStepResult = {
  id: string;
  type: string;
  status: "success" | "failed" | "skipped";
  output?: unknown;
  error?: string;
  skipReason?: string;
  costUsd?: number;
};
```

## What Not to Do

- Do not add a second scheduling or hook engine. All automation, regardless of
  its trigger shape, should go through the workflow surface.
