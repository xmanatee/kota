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
| File watch | `watch: "src/**/*.ts"` | When matching files change (daemon only) |
| Webhook | `webhook: true` | When a signed POST arrives at `/webhooks/:workflowName` |

Add `filter` to narrow event triggers. Add `cooldownMs` to prevent back-to-back
runs on noisy events. Add `debounceMs` to batch rapid file changes (default 500ms,
minimum 200ms). Watch triggers are only active when the daemon is running; they are
silently skipped in standalone `kota serve` mode. Webhook triggers require a
per-workflow HMAC secret in `.kota/config.json`; see [DAEMON-API.md](./DAEMON-API.md#webhook-trigger-endpoint)
for signing details, configuration, and the optional `webhookRateLimit` field.
Interval and idle triggers respect `scheduler.dispatchWindow` in config — see [CONFIG.md](./CONFIG.md#dispatchwindow).

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

### Cost Anomaly Alerts

`costAnomalyThreshold` enables per-workflow anomaly detection. After each run
completes, the runtime computes the run's cost against the rolling average of the
last 10 non-failed runs for that workflow. If the run cost exceeds
`costAnomalyThreshold × baseline`, a `workflow.cost.anomaly` bus event fires.
Telegram and webhook extensions forward this alert automatically.

Detection is skipped if fewer than 3 historical runs are available (not enough
baseline), or if the workflow has no `costAnomalyThreshold` set (opt-in only).

```typescript
const myWorkflow: WorkflowDefinitionInput = {
  name: "my-extension/long-job",
  costAnomalyThreshold: 3.0,  // alert if a run costs > 3× the historical average
  // ...
};
```

### Input and Output Schemas

`inputSchema` validates incoming trigger payloads before queuing. Invalid payloads are rejected with a descriptive error and the run is not queued. Workflows without `inputSchema` accept any payload (existing behavior).

`outputSchema` validates the last successful step's output when the run completes. A mismatch does not fail the run — it marks the run `completed-with-warnings` and records a structured warning alongside the output.

Both fields accept a JSON Schema object. The supported subset is: `type`, `properties`, `required`, `additionalProperties`, and `items` (for arrays).

```typescript
const myWorkflow: WorkflowDefinitionInput = {
  name: "my-extension/deploy",
  inputSchema: {
    type: "object",
    required: ["env"],
    properties: {
      env: { type: "string", description: "Target environment (staging or prod)" },
      dryRun: { type: "boolean" },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      deployed: { type: "boolean" },
      version: { type: "string" },
    },
  },
  // ...
};
```

The CLI (`kota workflow definitions`) shows a compact `Inputs: field*: type, ...` summary line for workflows with `inputSchema`. The web UI shows an inline input form before triggering, collecting required and optional fields with client-side validation. The web UI definitions panel also shows an `Outputs: field: type, ...` summary line for workflows that declare `outputSchema`.

When a trigger step fires a child workflow with `waitFor: "queued"` (the default), the child's output is never returned to the parent. If the child workflow declares an `outputSchema`, workflow validation emits a warning recommending `waitFor: "completed"` to access the child's output.

### Step Output Size Cap

By default, step outputs up to 256 KB are stored verbatim. If a step produces unusually large output (for example, an agent step that echoes a large file), the raw bytes can flood disk and the agent context window on subsequent steps.

Set `workflow.maxStepOutputBytes` in your config to cap the per-step output size. When a step output exceeds the cap, it is replaced with a structured truncation notice `{ "truncated": true, "originalBytes": N, "message": "..." }` and the run is marked `completed-with-warnings`. Applies to agent, code, trigger, and tool steps. Approval step outputs are exempt.

See [`workflow.maxStepOutputBytes` in CONFIG.md](CONFIG.md#maxstepoutputbytes) for defaults and the hard ceiling.

### Agent Step Fields

`type: "agent"` steps accept the following fields beyond the common step fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agentName` | `string` | — | Name of a registered `AgentDef`. Provides `promptPath`, `model`, `permissionMode`, and `settingSources` as defaults. |
| `promptPath` | `string` | — | Path to the prompt markdown file (relative to project root). Required when `agentName` is not set. |
| `model` | `string` | config default | Model to use for this step. Overrides `agentName` model default. |
| `maxTurns` | `number` | unlimited | Maximum agent turns before the step is interrupted. |
| `maxBudgetUsd` | `number` | — | Per-step spend cap in USD. When the ceiling is hit the step fails and a `workflow.cost.ceiling.exceeded` bus event is emitted carrying `workflow`, `runId`, `stepId`, `budgetUsd`, and `actualCostUsd`. |
| `thinkingEnabled` | `boolean` | `false` | Enable extended thinking (Claude reasons before responding). |
| `thinkingBudget` | `number` | `10000` | Token budget for thinking when `thinkingEnabled` is `true`. Minimum 1024. |
| `permissionMode` | `SDKPermissionMode` | `"bypassPermissions"` | Tool permission mode. |
| `allowedTools` | `string[]` | — | Restrict available tools to this list. |
| `disallowedTools` | `string[]` | — | Exclude these tools. |
| `outputFormat` | `"json"` | — | When set to `"json"`, appends an instruction to the agent prompt asking it to end its response with a fenced JSON block. After the step completes, the last fenced JSON block is extracted and becomes the step output (parsed). The step fails if no valid JSON block is found. |
| `outputSchema` | `object` | — | JSON Schema object (same subset as definition-level `inputSchema`/`outputSchema`) to validate the extracted JSON against. Requires `outputFormat: "json"`. A mismatch fails the step with a descriptive error. |

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
  {
    id: "decide",
    type: "agent",
    promptPath: "src/workflows/my-workflow/decide.md",
    outputFormat: "json",
    outputSchema: {
      type: "object",
      required: ["action"],
      properties: { action: { type: "string" } },
    },
  },
]
```

Extended thinking is off by default. Enable it on steps where deeper reasoning
improves output quality (e.g., complex planning or architecture steps). It increases
cost and latency proportionally to the token budget.

#### Agent step cost

After an agent step completes, `WorkflowStepResult.costUsd` is populated with the USD cost of that step. The `workflow.step.completed` bus event includes this as an optional `costUsd` field. The daemon API run detail (`GET /api/workflow/runs/:id`) includes `costUsd` per step in the `steps` array. The web UI run detail shows a compact cost annotation (e.g., `$0.04`) next to agent step rows where cost is greater than zero.

Non-agent steps (code, tool, emit, branch, foreach, approval) do not set `costUsd`.

#### Agent step tool-use summary

After an agent step completes, `WorkflowStepResult.toolCalls` is populated with a sorted list of `{ tool, count, totalMs }` entries — one per distinct tool invoked during the step. The daemon API run detail (`GET /api/workflow/runs/:id`) includes `toolCalls` per step in the `steps` array. The web UI run detail shows a compact annotation (e.g., `Tools: Bash×14, Read×6, Edit×3`) under each completed agent step row.

Data is read from the `.tool-telemetry.json` artifact written by the agent executor. The field is absent for steps that recorded no tool calls.

Non-agent steps do not set `toolCalls`.

### Hook-like reaction

React to a workflow completion:

```typescript
triggers: [
  { event: "workflow.completed", filter: { workflow: "builder", status: "success" } },
]
```

Any event on the internal bus can be a trigger. The bus emits `workflow.started`,
`workflow.completed`, `workflow.step.completed`, `file.changed`, and more.
See `src/event-bus.ts` for the full list.

### File-watch trigger

React when matching files change on disk (daemon only):

```typescript
triggers: [
  { watch: "src/**/*.ts", debounceMs: 1000 },
]
```

`watch` accepts a glob string or an array of glob strings. When one or more files
match and settle after the debounce window, the workflow is queued with a
`files.changed` event payload:

```json
{ "files": ["src/foo.ts", "src/bar.ts"], "triggeredAt": "2026-04-01T12:00:00.000Z" }
```

Access the list of changed files in a code step via `ctx.trigger.payload.files`.
Watch triggers are mutually exclusive with event, schedule, interval, and webhook
fields on the same trigger object.

### Inbound webhook

Fire when an external system POSTs a signed request (CI, GitHub, external tooling):

```typescript
triggers: [{ webhook: true }],
webhookRateLimit: { maxPerMinute: 30 },  // optional
```

The workflow name becomes the URL slug: `POST /webhooks/my-workflow`.
Requests must include an HMAC-SHA256 signature header (`X-Kota-Webhook-Signature`).
The secret lives in `.kota/config.json` under `webhooks.<name>.secret` (keep gitignored).
The optional `webhookRateLimit.maxPerMinute` caps throughput per workflow; the daemon
returns 429 with a `Retry-After` header when exceeded. See
[DAEMON-API.md](./DAEMON-API.md#webhook-trigger-endpoint) for signing details and
configuration. For a step-by-step guide to triggering KOTA workflows from GitHub Actions,
see [GITHUB-ACTIONS.md](./GITHUB-ACTIONS.md).

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

**Step output (when `waitFor: "completed"`):** The step result includes `{ runId, status, childOutput? }`. `childOutput` is the output of the last successful step of the child run, letting the parent branch on or pass through the child's result via `{{stepOutputs.stepId.childOutput.field}}` interpolation.

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

### Branch Steps

A `type: "branch"` step evaluates a condition and runs either `ifTrue` or `ifFalse` steps in order. Only one arm runs per evaluation.

```typescript
steps: [
  {
    id: "check-day",
    type: "branch",
    condition: () => new Date().getDay() >= 1 && new Date().getDay() <= 5,
    ifTrue: [
      {
        id: "weekday-step",
        type: "agent",
        promptPath: "src/workflows/my-workflow/weekday-prompt.md",
      },
    ],
    ifFalse: [
      {
        id: "weekend-step",
        type: "emit",
        event: "workflow.skipped",
        payload: { reason: "weekend" },
      },
    ],
  },
]
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `condition` | predicate | — | Required. Evaluated before choosing an arm. When true, `ifTrue` runs; otherwise `ifFalse`. |
| `ifTrue` | `WorkflowStep[]` | — | Required. Steps to execute when condition is true. |
| `ifFalse` | `WorkflowStep[]` | `[]` | Optional. Steps when condition is false. Omit for a no-op false branch. |
| `when` | predicate | — | Outer skip guard. If false, the entire branch step (and both arms) is skipped. |
| `continueOnFailure` | `boolean` | `false` | If true, the parent workflow continues even if the chosen arm fails. |
| `timeoutMs` | `number` | 30 min | Maximum time for the entire branch arm to complete. |

Steps inside `ifTrue`/`ifFalse` support all existing step types (agent, code, emit, trigger, parallel, foreach) and their `when` predicates. Nested `branch` steps are allowed up to depth 5. `restart` steps are not allowed inside branch arms.

After a branch step completes, downstream steps can access arm step outputs via `context.stepOutputs[armStepId]`. Steps in the non-taken arm are recorded as skipped.

### Foreach Steps

A `type: "foreach"` step iterates over a list of items, running a sequence of inner steps for each item in order. Use it when a workflow needs to act on each element of a dynamic list.

```typescript
steps: [
  {
    id: "get-targets",
    type: "code",
    run: () => ["service-a", "service-b", "service-c"],
  },
  {
    id: "check-each-target",
    type: "foreach",
    items: (ctx) => ctx.stepOutputs["get-targets"] as string[],
    as: "target",
    steps: [
      {
        id: "verify",
        type: "code",
        run: (ctx) => verifyTarget(ctx.foreach?.["target"] as string),
      },
    ],
  },
]
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `items` | `unknown[] \| (ctx) => unknown[]` | — | Required. The array to iterate over. May be a static array or a function that receives the step context. |
| `as` | `string` | — | Required. Name to use for the current item inside inner step resolvers, accessible via `ctx.foreach?.["<name>"]`. |
| `steps` | `(WorkflowCodeStepInput \| WorkflowAgentStepInput)[]` | — | Required. Non-empty array of steps to run for each item. Only `code` and `agent` steps are supported inside a foreach body. |
| `when` | predicate | — | Outer skip guard. If false, the entire foreach step is skipped. |
| `continueOnFailure` | `boolean` | `false` | If true, a failing item does not abort the loop — the workflow continues with warnings after all items are processed. |
| `maxConcurrency` | `number` | `1` | Maximum number of items to execute concurrently. Defaults to 1 (serial). Must be a positive integer. Values > 1 are rejected at definition load time if any inner step is an `agent` step. |
| `timeoutMs` | `number` | 30 min | Maximum time for the entire foreach loop to complete. |

By default iteration is **sequential** — each item completes before the next begins. Set `maxConcurrency` to a value greater than 1 to run up to that many items simultaneously (code steps only). Results in the step output are always ordered by item index, not completion order. A failed batch stops further batches from starting unless `continueOnFailure` is set. The foreach step result output contains `{ items: N, results: [...] }` with per-item status. Downstream steps can access the last iteration's inner step output via `context.stepOutputs["<innerStepId>"]`.

### Approval Steps

An `approval` step pauses workflow execution and waits for a human decision via the existing approval queue. Use it to insert explicit operator gates before consequential actions like deployments, bulk mutations, or financial transactions.

```ts
{
  type: "approval",
  id: "confirm-deploy",
  reason: "Review the staged changes before deploying to production",
  timeoutMs: 24 * 60 * 60 * 1000,   // 24 hours
  defaultResolution: "deny",          // auto-deny if nobody responds
}
```

When execution reaches an approval step the runtime:

1. Writes a `source: "workflow-step"` entry to the approval queue (visible in `kota approval list` and the web UI).
2. Blocks the workflow run — no further steps execute until the approval is resolved.
3. On **approve**: records the step as `success` and continues to the next step.
4. On **reject** or **expire** (with `defaultResolution: "deny"`): fails the run with a descriptive error and follows the normal failure path (`workflow.failure.alert` emitted if configured).
5. On **expire** with `defaultResolution: "approve"`: auto-approves and continues.

The approval queue entry includes the workflow name, run ID, step ID, and the optional `reason` string so operators can identify what they are approving.

#### Approval step fields

| Field | Type | Default | Description |
|---|---|---|---|
| `id` | `string` | — | Required. Step identifier. |
| `reason` | `string` | — | Human-readable description shown in the approval UI and CLI. |
| `timeoutMs` | `number` | 30 min | How long to wait before auto-resolving. Inherits the base step timeout. |
| `defaultResolution` | `"deny" \| "approve"` | `"deny"` | Resolution applied when `timeoutMs` elapses without a human decision. |
| `when` | predicate | — | Skip guard. If false, the approval step is skipped and execution continues. |
| `continueOnFailure` | `boolean` | `false` | If true, a rejection does not abort the run. |

Approval steps are **not allowed** inside `parallel`, `branch`, or `foreach` bodies. Placing one there is a definition-load-time error.

Approval requests created by workflow steps have `source: "workflow-step"` in the approval record, distinguishing them from guardrail-generated requests (`source: "guardrail"`). Use `kota approval list` to see pending requests; both sources appear in the same list.

#### Approval step output

When the step succeeds (operator approved), the step output is:

```json
{
  "approvalId": "<id>",
  "approved": true,
  "resolvedAt": "<ISO timestamp>",
  "resolutionSource": "human",
  "approvalNote": "<operator note>"
}
```

`approvalNote` is only present when the operator supplied a note via `kota approval approve <id> --note "..."` or the web UI. Downstream agent steps can read it via `{{stepOutputs.<stepId>.approvalNote}}`.

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
| `branch` | Evaluates the `condition` predicate, runs the chosen arm's steps, records the other arm as skipped. Mock the condition via a code step or `stepMocks`. |

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

## Operator Commands

### Inspect a run

```
kota workflow run show <run-id> [--payload] [--step <step-id>] [--chain]
```

Prints step-level detail for a run: status, duration, cost, and per-step output summaries. For `completed-with-warnings` runs, also prints a `Warnings:` section listing each warning message.

- `--payload` — also prints the trigger payload as formatted JSON below the Trigger line.
  Useful for webhook and github-event triggered runs where the payload (repo, branch, PR
  number) explains why the run fired.
- `--step <step-id>` — prints the full JSON output (or error) for a single step. Skips
  the daemon API path and reads from disk.
- `--chain` — prints the full causal chain tree rooted at the highest reachable ancestor
  (up to 5 levels), marking the current run with `← current`. Useful for tracing which
  explorer or builder run produced a given downstream notification or restart.

Supports prefix matching: `kota workflow run show 2026-03-30T18` resolves to the matching run.

### Trigger a run manually

```
kota workflow trigger <name> [--payload <json>] [--force]
```

Enqueues a new run. `--payload` merges extra fields into the trigger payload.
`--force` bypasses cooldown.

### Replay a completed run

```
kota workflow replay <run-id>
```

Reads the trigger payload from the stored run record and enqueues a new run of
the same workflow using that payload. The new run's trigger event is
`workflow.replay`; the payload includes a `replayOf` field pointing to the
original run ID so the two runs are traceable.

- Works for any terminal status (success, failed, interrupted).
- Fails if the run is still active (`status: running`).
- Fails if the workflow definition no longer exists.
- If the workflow is already queued, the command exits with an error.

The run detail view in the web UI also shows a **Replay** button for completed
runs that performs the same action and shows the new run ID inline.

### Resume a failed run from a specific step

```
kota workflow resume-run <run-id> --from-step <step-id>
```

Resumes a failed or interrupted run starting from a specific step, reusing the
completed step outputs from the source run for all prior steps. The resumed run
records reused steps with a `(reused)` marker in `kota workflow show` output and
links back to the source run via `resumedFromRunId` in its metadata.

- Requires all steps before `--from-step` to have completed successfully in the
  source run; returns an error otherwise.
- The source run must be in a terminal state (`failed`, `interrupted`, or
  `completed-with-warnings`).
- For-each and parallel steps are replayed but not re-executed; their prior
  outputs are carried forward.

### Retry a failed run

```
kota workflow retry <run-id>
```

Re-fires a failed or interrupted run. Unlike replay, retry is restricted to
non-successful runs and uses `event: "retry"` in the trigger payload.

### Abort an active run

```
kota workflow run abort <run-id>
```

Signals a specific active run to stop at its next step boundary, using the same
clean-abort semantics as the global `kota workflow abort`.

- Fails if no daemon is running.
- Fails if the run is not found or not active (use `kota workflow cancel` for queued runs).

The run detail view in the web UI also shows an **Abort** button in the header for
active runs (status `running` or `repairing`) that performs the same action.

### Inspect definition history

```
kota workflow definition-log <workflow-name> [--diff]
```

Shows the git commit history for a workflow's definition file. Each line shows
commit hash, date, and message. `--diff` adds the file diff for each commit.

Fails gracefully if the repository is not a git repo or if the definition file
is not tracked by git.

### Enable or disable a workflow

```
kota workflow enable <name>
kota workflow disable <name>
```

Enables or disables a workflow at runtime without editing its definition file.
The override is in-memory only — it is cleared when the daemon restarts. To
make the change permanent, set `enabled: false` in the workflow definition.

- Requires a running daemon.
- `kota workflow status` shows the effective enabled state.

### Validate definitions (CI / pre-commit)

```
kota workflow validate [--workflow <name>] [--json]
```

Loads all workflow definitions and runs structural validation without triggering
or running anything. Prints per-definition `PASS` / `FAIL` results and exits
non-zero if any fail. Use in CI pipelines or git pre-commit hooks to catch
definition errors before they reach the daemon.

- `--workflow <name>` — validate a single definition by name.
- `--json` — emit a structured JSON array of `{ name, valid, error? }` objects.
- Does not require a running daemon.

## Operator Notifications

The following bus events are emitted during workflow execution and can be forwarded
to operators via the Telegram and Slack extensions.

### Builder commit notification (`workflow.build.committed`)

After the builder workflow successfully commits a task change, it emits:

```json
{
  "runId": "2026-04-02T09-45-18-046Z-builder-ic7a2r",
  "taskId": "task-foo-bar",
  "commitMessage": "Add foo bar support",
  "costUsd": 0.42,
  "durationMs": 480000
}
```

This event is **opt-in** per extension (off by default) to avoid noise when builder runs
frequently. To enable it, add `workflow.build.committed` to the `events` list in the
extension config:

```json
// kota.config — under the "slack" key
{
  "slack": {
    "webhookUrl": "https://hooks.slack.com/services/...",
    "events": ["workflow.build.committed", "workflow.failure.alert"]
  }
}
```

For Telegram, add the same `events` list under the `"telegram"` key:

```json
{
  "telegram": {
    "events": ["workflow.build.committed"]
  }
}
```

The emitted message reads:
```
✅ Builder committed: Add foo bar support
Task: task-foo-bar · $0.42 · 8m
```

## What Not to Do

- Do not add a second scheduling or hook engine. All automation, regardless of
  its trigger shape, should go through the workflow surface.
