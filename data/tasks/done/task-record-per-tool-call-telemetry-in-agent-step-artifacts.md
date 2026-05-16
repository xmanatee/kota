---
id: task-record-per-tool-call-telemetry-in-agent-step-artifacts
title: Record per-tool-call telemetry in agent step artifacts
status: done
priority: p2
area: observability
summary: Persist one structured record per tool call with tool-use id, timing, success, and bounded payload-size metadata so run diagnostics can catch slow or oversized calls without rereading raw transcripts.
created_at: 2026-05-16T23:22:03Z
updated_at: 2026-05-16T23:37:10Z
---

## Problem

KOTA already writes aggregate tool telemetry for agent workflow steps and
surfaces a compact `toolCalls` summary in step metadata. That is enough to see
that a step used `shell` or `file_read` many times, but it loses the individual
call identity and payload scale that operators need when one call stalls, one
tool result balloons, or one harness adapter drops a specific observation.

The raw agent event log contains `tool_call` / `tool_result` messages with
`toolUseId`, but the structured telemetry artifact collapses those messages
into per-tool totals. Diagnosing a bad run still means replaying raw JSONL and
reconstructing durations by hand. Recent peer runtime release notes are moving
the other direction: tool calls are first-class turn items, hook/tool events
carry tool-use ids, and oversized MCP/hook output is treated as a runtime
defect rather than an operator mystery.

## Desired Outcome

Each agent step's existing telemetry artifact includes a bounded per-call
section alongside the current aggregate summary. The per-call records preserve
correlation and size metadata without persisting raw tool input or output:

```json
{
  "summary": "3 tool calls, 2 ok, 1 failed, avg 240ms",
  "tools": {
    "shell": { "calls": 2, "successes": 1, "failures": 1, "totalMs": 700, "avgMs": 350 }
  },
  "calls": [
    {
      "toolUseId": "tu-1",
      "tool": "shell",
      "durationMs": 520,
      "success": false,
      "inputBytes": 84,
      "resultBytes": 12034,
      "resultContentKind": "text",
      "truncated": false
    }
  ]
}
```

The run artifact should let an operator answer "which exact call was slow or
large?" from one structured file, while the daemon API and UI can keep using the
existing aggregate `toolCalls` field unless they deliberately need call-level
detail later.

## Constraints

- Extend the existing `<step>.tool-telemetry.json` artifact; do not add a new
  store, database table, or parallel telemetry file.
- Keep raw inputs, raw outputs, secrets, and rich content blocks out of the
  per-call records. Store only ids, tool names, success, timing, byte counts,
  coarse content kind, and explicit truncation/omission flags.
- Preserve the current aggregate artifact shape for existing consumers. Adding
  `calls` is acceptable; renaming `summary` or `tools` is not.
- Treat missing `tool_result` messages as an explicit incomplete call state
  instead of silently dropping the call from per-call telemetry.
- Keep the implementation harness-neutral. SDK-native messages, local
  `executeToolCalls`, and MCP-routed tools should all flow through the same
  neutral agent-message/tool-runner protocol.
- Do not add a user-facing UI surface in this task.

## Done When

- Agent step telemetry artifacts include a bounded `calls` array with one
  record per observed tool call, keyed by `toolUseId`.
- Each completed call records duration, success/failure, input byte count,
  result byte count, and coarse result content kind without storing raw payloads.
- Calls that never receive a matching result are represented as incomplete with
  the available id/tool/input metadata.
- Existing aggregate `summary` and `tools` fields remain present and compatible.
- Local tool execution and SDK-message telemetry are both covered by focused
  tests, including at least one failing tool result and one oversized result.

## Source / Intent

Explorer run `2026-05-16T23-20-05-872Z-explorer-4ntx5l` reviewed an empty
actionable queue. The strategic blocked alternatives exposed by
`inspect-queue` all require operator-captured artifacts and are not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

Several recent watchlist gaps were already completed before this run, including
MCP output schemas, MCP result-variant preservation, tool-observation
summarization, GUI coordinate scaling, shipped-preset pricing, and realtime
voice lifecycle probing. The remaining nonduplicative signal is tool-call
observability: Claude Code release notes added richer hook/tool event metadata,
Codex release notes call out MCP tool calls as turn items and fixes for
unbounded MCP/hook output growth, and LiveKit Agents continues to emphasize
runtime telemetry for latency and turn behavior.

Sources checked:

- `https://github.com/anthropics/claude-code/releases`
- `https://github.com/openai/codex/releases`
- `https://github.com/livekit/agents/releases`
- `src/core/workflow/steps/step-executor-agent-telemetry.ts`
- `src/core/tools/tool-runner.ts`
- `data/tasks/done/task-tool-telemetry-persist.md`
- `data/tasks/done/task-agent-step-tool-summary.md`

## Initiative

Run observability: KOTA should make runtime failures, slow tools, and oversized
tool observations diagnosable from typed run artifacts instead of requiring
operators to reconstruct behavior from raw transcripts.

## Acceptance Evidence

- Test transcript for focused telemetry coverage, for example
  `pnpm test src/workflow-step-executor.integration.test.ts src/tool-telemetry.integration.test.ts`.
- A sample run artifact or fixture shows `summary`, `tools`, and the new
  bounded `calls` array together.
- Diff review shows no raw tool inputs/results persisted in the per-call
  telemetry records and no new telemetry store or UI surface.
