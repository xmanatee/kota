---
id: task-serialize-mutating-agent-tool-calls-while-preservi
title: Serialize mutating agent tool calls while preserving read-only parallelism
status: ready
priority: p2
area: core
summary: Change agent-loop tool execution so read-only calls can run concurrently while mutating or destructive calls are ordered with surrounding calls, using tool effects and MCP readOnlyHint instead of blanket Promise.all.
created_at: 2026-05-27T19:12:50.438Z
updated_at: 2026-05-27T19:12:50.438Z
---

## Problem

`executeToolCalls` currently wraps every same-turn tool call in one
`Promise.all`, so a model response that contains a read, a write, and another
read starts all three at once. That is fine for independent read-only calls,
but it is unsafe for local writes, daemon-state writes, external mutations, and
destructive actions. Those calls can race each other, race adjacent reads that
the model expected to observe before or after the mutation, and produce
result-order evidence that hides the actual execution order.

KOTA already has the ingredients for a narrower policy. Local tools declare a
structured `ToolEffect`, and the MCP server surface already derives
`readOnlyHint` from that effect. External MCP tools can also advertise
`readOnlyHint`. The missing piece is applying those declarations to agent-loop
tool execution instead of treating every batch as safely parallel.

## Desired Outcome

Agent-loop tool execution preserves parallelism where it is semantically safe:
contiguous read-only tool calls may execute concurrently, while any call that
is write, destructive, unknown, or not proven read-only is ordered with the
calls around it.

The execution result array still matches the model's original tool-call order,
but the actual scheduler is effect-aware. Local tools use `getToolEffect`;
MCP-namespaced tools use the remote tool's advertised annotations when
available; MCP tools without an explicit `readOnlyHint: true` are treated as
ordered/mutating by default.

## Constraints

- Keep the policy in the shared tool execution path, not in one harness
  adapter. Claude, OpenAI tools, Vercel, Gemini, and any future
  `executeToolCalls` consumer should inherit the same behavior.
- Do not add a second risk taxonomy. Reuse `ToolEffect` for KOTA-local tools
  and MCP annotations for remote tools; unknown or malformed metadata should
  fail closed into ordered execution.
- Preserve guardrails, autonomy-mode gating, approval queue behavior, telemetry,
  result truncation, secret masking, abort propagation, and middleware behavior.
- Preserve result ordering even when read-only calls execute in parallel.
- Do not serialize the whole batch unconditionally; read-heavy turns should
  retain real concurrency.

## Done When

- `executeToolCalls` runs contiguous read-only local tool calls concurrently
  and returns results in model order.
- A mutating or destructive local tool call acts as a barrier: earlier
  read-only calls finish before it starts, it completes before later calls
  start, and adjacent mutating calls run one at a time.
- MCP-namespaced tools with advertised `readOnlyHint: true` can join read-only
  parallel batches; MCP tools with `readOnlyHint: false`, missing annotations,
  or unknown metadata run as ordered barriers.
- Focused tests prove the timing/order behavior without relying on wall-clock
  flakiness, for example by using deferred promises or explicit start/finish
  probes.
- Existing guardrail/approval/truncation/telemetry tests for tool execution
  remain green.

## Source / Intent

Explorer run `2026-05-27T19-10-32-115Z-explorer-wb9eya` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and were not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External source checked:

- `https://github.com/openai/codex/releases` — Codex 0.134.0 (2026-05-26)
  says read-only MCP tools may run concurrently when they advertise
  `readOnlyHint`. The useful KOTA signal is not "copy Codex behavior"; it is
  that tool-call parallelism should be keyed to explicit read-only metadata,
  not blanket concurrency.

Local evidence:

- `src/core/tools/tool-runner.ts` says `executeToolCalls` executes tool calls in
  parallel and implements that with `Promise.all(toolBlocks.map(...))`.
- `src/core/tools/effect.ts` already defines `ToolEffect` and derives MCP
  annotations, including `readOnlyHint`.
- `src/core/tools/index.ts` exposes `getToolEffect(name)` for local registered
  tools.
- `src/modules/mcp-server/server.test.ts` already asserts first-party MCP
  `tools/list` includes `readOnlyHint: true` for read-tier tools.
- Repository search found no open task for same-turn agent tool-call
  serialization or read-only-batched execution.

## Initiative

Agent-loop correctness and harness-neutral runtime safety.

## Acceptance Evidence

- Focused test run for the tool runner, for example
  `pnpm test src/core/tools/tool-runner.test.ts`.
- Relevant MCP manager/client tests proving remote `readOnlyHint` metadata is
  retained where the scheduler needs it.
- `pnpm run typecheck`
- `pnpm exec biome check src/core/tools src/core/mcp`
