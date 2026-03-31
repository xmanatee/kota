---
id: task-tool-telemetry-persist
title: Persist tool telemetry data into workflow run artifacts
status: done
priority: p3
area: runtime
summary: Tool call timing and failure rates are tracked per session via ToolTelemetry but are never written to disk. Saving this data to run artifacts would let operators and the improver analyze which tools are slow or error-prone on specific runs.
created_at: 2026-03-31T06:00:00Z
updated_at: 2026-03-31T07:37:58Z
---

## Problem

`ToolTelemetry` in `src/tool-telemetry.ts` records per-tool call counts, success rates, timing stats, and last error for the duration of a session. This data is valuable for diagnosing slow runs, tool failures, and retry patterns. However, it is only held in memory and is lost when the session ends. Workflow run artifacts contain step outputs and cost data but no tool-level telemetry.

Operators and the improver currently have no way to answer: "Which tools were called most during this builder run?" or "Did this run have an unusual tool failure rate?"

## Desired Outcome

At the end of each agent workflow step, write a `tool-telemetry.json` file to the step's run artifact directory. The file should contain the per-tool stats snapshot from `ToolTelemetry.getStats()`:

```json
{
  "summary": "42 tool calls, 40 ok, 2 failed, avg 380ms",
  "tools": {
    "shell": { "calls": 20, "successes": 20, "failures": 0, "totalMs": 8000, "avgMs": 400 },
    "file_edit": { "calls": 12, "successes": 11, "failures": 1, "totalMs": 3600, "avgMs": 300, "lastError": "..." }
  }
}
```

The file is written only for agent steps (not code or tool steps). The run artifact directory already exists by the time the step completes.

## Constraints

- Write to the step run directory alongside existing step outputs; do not create a new store or API surface.
- Only write when there is at least one tool call to report (skip empty sessions).
- `ToolTelemetry` is reset per session via `resetToolTelemetry()` in `loop-init.ts`; the write should happen at step completion, before reset.
- No changes to the `ToolTelemetry` public API — only write logic in the step executor layer.
- The file is informational only; no validation or required schema beyond the structure above.

## Done When

- After an agent workflow step, `tool-telemetry.json` appears in the step's run artifact directory when at least one tool was called.
- The file contains per-tool call counts, success/failure counts, total time, and average time.
- At least one test covers the write path (can be an integration test on a minimal agent step).
