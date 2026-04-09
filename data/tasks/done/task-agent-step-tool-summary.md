---
id: task-agent-step-tool-summary
title: Include tool-use summary in agent step output metadata
status: done
priority: p3
area: observability
summary: After an agent step completes, there is no compact record of which tools it called or how many times. Adding a tool-use summary to step metadata lets operators and the web UI show what an agent step actually did without reading the full session transcript.
created_at: 2026-04-02T08:57:28Z
updated_at: 2026-04-02T09:32:00Z
---

## Problem

A completed agent step records its output and cost (once that lands) but nothing about tool use. When an operator opens a run detail and sees an agent step that took 8 minutes, they have no quick way to see "this step called Bash 14 times, Read 6 times, Edit 3 times" without scrolling the full message log or reading raw run artifacts.

This makes diagnosing slow or expensive agent steps slow, and makes the web UI less informative. The telemetry system (`tool-telemetry.ts`) already records tool call latency to disk, but that data is not surfaced in the run detail.

## Desired Outcome

After an agent step completes, `WorkflowStepResult` (or an optional metadata field on it) includes a compact tool-use summary:

```json
{
  "toolCalls": [
    { "tool": "Bash", "count": 14, "totalMs": 42000 },
    { "tool": "Read", "count": 6, "totalMs": 800 }
  ]
}
```

The web UI run detail renders this as a compact "Tools used:" line under each agent step row (collapsed by default, expandable).

## Constraints

- Read tool-use data from the step's session transcript or from tool telemetry already captured during the run; do not add a new persistence layer.
- `toolCalls` is optional — steps with no tool calls or non-agent steps omit the field.
- The web UI rendering should be minimal: a single collapsed line, not a full breakdown panel.
- No changes to the daemon API contract beyond adding the optional field to step metadata in run detail responses.

## Done When

- Agent step completion records `toolCalls` summary in `WorkflowStepResult` or equivalent step metadata.
- Daemon API run detail includes `toolCalls` per step when present.
- Web UI step list shows a collapsed "Tools: Bash×14, Read×6, Edit×3" annotation for agent steps.
- Unit test verifies summary is built correctly from a mock session transcript.
