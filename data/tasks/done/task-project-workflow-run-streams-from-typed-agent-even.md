---
id: task-project-workflow-run-streams-from-typed-agent-even
title: Project workflow run streams from typed agent event logs
status: done
priority: p2
area: modules
summary: Route workflow run SSE output through KOTA's KotaAgentMessage event log instead of parsing obsolete assistant.content blocks, and add tests for text, thinking, tool calls, results, and run completion.
created_at: 2026-05-27T10:55:40.648Z
updated_at: 2026-05-27T11:12:50.236Z
---

## Problem

Workflow agent steps persist live step frames as `KotaAgentMessage` JSONL
under `.kota/runs/<run-id>/steps/<step>.events.jsonl`. That is the repo's
strict typed stream surface: text, thinking, tool call, tool result, status,
result, and raw adapter frames.

The workflow run SSE route in `src/modules/workflow-ops/routes/workflow-run-routes.ts`
still tries to decode those files as an older provider-shaped assistant
message with `message.content[]` blocks. That means active run streaming can
announce steps and completion while dropping the actual agent text/tool frames
that the builder, web dashboard, and operator follow surfaces need. Current
tests only cover invalid IDs and inactive runs, so this stale decoder can
remain broken.

## Desired Outcome

Workflow run streaming projects the canonical `KotaAgentMessage` event log
into stable operator-facing SSE events. Active runs show assistant text,
tool calls, tool results/status/result frames where appropriate, and run
completion without requiring clients to understand provider-native payloads.

The implementation should treat LangGraph's current typed stream-projection
direction as validation of KOTA's existing protocol choice, not as a reason to
import LangGraph or add a workflow DSL. KOTA already owns the typed event log;
this task makes the workflow-ops route consume it honestly.

## Constraints

- Keep the work in `src/modules/workflow-ops/` unless a small core type export
  is genuinely necessary. Do not add a parallel stream registry.
- Decode `KotaAgentMessage` variants directly, preferably through a shared
  projector/helper that both route tests and CLI follow/log code can exercise.
- Do not branch on provider-native assistant content or `raw.payload` shapes in
  core workflow code. Opaque raw adapter frames may be surfaced only as bounded
  status/debug events or omitted deliberately.
- Preserve the existing thinking boundary: thinking frames may use the
  dedicated `step_thinking` stream/route, but they must not be folded into
  ordinary `step_output` transcript lines.
- Preserve JSON, machine-readable, and historical run read paths. Completed
  run logs should continue to render through `workflow-logs.ts`.
- Keep event names stable for existing clients unless the task updates every
  in-repo consumer and tests the new shape.

## Done When

- `handleWorkflowRunStream` emits output from persisted `KotaAgentMessage`
  JSONL frames rather than the obsolete `assistant.message.content` decoder.
- Active-run SSE sends text, tool-call, tool-result/status/result, thinking,
  step-started, step-completed, and run-completed information in a stable typed
  envelope.
- The route handles partial files and newly appended events without duplicate
  sends across polling ticks.
- Malformed JSONL lines cannot crash the stream; the behavior is explicit and
  covered by tests.
- Existing CLI `workflow follow` / run-log behavior still works for completed
  and active runs.
- No provider-specific stream payload leaks into the daemon API contract.

## Source / Intent

Explorer run `2026-05-27T10-51-55-406Z-explorer-ygd6s4` reviewed a zero
actionable queue. The strategic blocked alternatives all still require
operator-captured evidence and were not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External signal checked:

- `https://docs.langchain.com/oss/javascript/langgraph/event-streaming`
  documents LangGraph's v3 event streaming as typed projections for messages,
  state, subgraphs, tools, lifecycle, checkpoints, input, tasks, and custom
  channels rather than consumers filtering provider-shaped event dictionaries.
- `https://reference.langchain.com/python/langgraph/pregel/main/Pregel/stream_events`
  describes `stream_events(version="v3")` returning a run stream with typed
  projections and stable final output/interruption fields.

Local overlap check:

- `src/core/agent-harness/agent-message.ts` already defines the strict
  `KotaAgentMessage` union used by harness adapters.
- `src/core/workflow/active-run-handle.ts` appends those messages to
  `<step>.events.jsonl`.
- `src/modules/workflow-ops/runs/workflow-logs.ts` reads the same JSONL as
  `KotaAgentMessage[]` for CLI/log rendering.
- `src/modules/workflow-ops/routes/workflow-run-routes.ts` still parses the
  JSONL as an `assistant` event with nested content blocks, so normal
  `type: "text"` / `type: "tool_call"` / `type: "thinking"` frames are ignored.
- `src/modules/workflow-ops/routes/workflow-routes.test.ts` has only negative
  coverage for `handleWorkflowRunStream`, not a positive active-run stream
  projection case.

## Initiative

Typed operator streams: workflow clients should consume one KOTA-owned
protocol for live agent-step progress, with no stale provider-shape adapters
between run artifacts and daemon/client surfaces.

## Acceptance Evidence

- Focused workflow-ops route tests pass, including a positive active-run SSE
  fixture that writes `KotaAgentMessage` JSONL frames and observes the emitted
  stream events:
  `pnpm test src/modules/workflow-ops/routes/workflow-routes.test.ts`.
- Existing workflow log/follow tests pass:
  `pnpm test src/modules/workflow-ops/runs/workflow-logs.test.ts`.
- A runtime probe or transcript under `.kota/runs/<run-id>/` shows a running
  workflow step appending text, tool call, thinking, and result frames and the
  `/api/workflow/runs/<id>/stream` route emitting the corresponding SSE events
  without duplicate frames.
