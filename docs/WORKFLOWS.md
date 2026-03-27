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

## Common Patterns

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
