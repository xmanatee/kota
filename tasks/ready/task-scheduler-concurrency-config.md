---
id: task-scheduler-concurrency-config
title: Expose workflow agent and code concurrency limits in kota.json config
status: ready
priority: p2
area: runtime
summary: The workflow runtime has agentConcurrency (default 1) and codeConcurrency (default 4) limits that control how many agent or code workflows run in parallel, but neither is configurable via kota.json. Operators building custom parallel workflows have no way to tune these without source changes.
created_at: 2026-04-09T05:00:00Z
updated_at: 2026-04-09T05:00:00Z
---

## Problem

`WorkflowRuntime` accepts `agentConcurrency` and `codeConcurrency` via its
`WorkflowRuntimeConfig`, but those values are never read from the operator's
`kota.json` — they default to 1 and 4 respectively, permanently.

For operators who build custom agent workflows that are safe to run in parallel
(e.g., per-branch review agents, nightly analysis jobs, parallel test runners)
there is no config knob to raise the agent concurrency limit beyond 1. They
must either fork the daemon code or accept strictly serial dispatch.

The `scheduler` config namespace already exists (it contains `dispatchWindow`
and `quietHours`); concurrency limits fit naturally there.

## Desired Outcome

`kota.json` accepts two new optional keys under `scheduler`:

```json
{
  "scheduler": {
    "agentConcurrency": 2,
    "codeConcurrency": 8
  }
}
```

When set, these override the built-in defaults. When absent, the existing
defaults (1 and 4) apply unchanged.

The daemon reads these from config and passes them to `WorkflowRuntime` at
startup. They are also visible in `kota workflow status --json` so operators
can confirm the active limits.

## Constraints

- The autonomous built-in loop (explorer → builder → improver) is unaffected
  because each of those workflows runs independently and the default of 1
  already serializes them correctly.
- Values must be positive integers. Zero or negative values should produce a
  config warning and fall back to defaults.
- No changes to the `WorkflowRuntimeConfig` interface are needed beyond threading
  the values through from `KotaConfig`; `WorkflowRuntime` already reads them
  from that interface.
- `config-warnings.ts` should validate these keys when present.

## Done When

- `scheduler.agentConcurrency` and `scheduler.codeConcurrency` in `kota.json`
  are read and honored by the workflow runtime.
- Setting `agentConcurrency: 2` allows two agent workflows to run concurrently.
- CONFIG.md documents the two new keys with types, defaults, and caveats.
- `kota workflow status` output (or `--json`) reflects the active concurrency
  limits when the daemon is running.
- A unit test covers the config parse and default-fallback paths.
