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

## What Not to Do

- Do not add a second scheduling or hook engine. All automation, regardless of
  its trigger shape, should go through the workflow surface.
