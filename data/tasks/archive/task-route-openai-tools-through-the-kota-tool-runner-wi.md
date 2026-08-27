---
status: done
---

# Route openai-tools through the KOTA tool runner with MCP and approvals

## Problem

The `openai-tools` harness currently hosts its own tool dispatch path. It calls
the registry-level `executeTool` directly, rejects non-empty `mcpServers`,
rejects `autonomyMode: "supervised"`, and does not use the shared
`executeToolCalls` scheduling and safety path. That means OpenRouter and local
models can run tools, but not with full KOTA parity.

This is a capability and safety blocker. A model replacement path that bypasses
MCP declaration checks, approval queues, guardrail policy, idempotency,
telemetry, result truncation, and read-only tool scheduling cannot be treated
as a Codex/Claude alternative.

## Desired Outcome

The `openai-tools` harness runs model-emitted tool calls through the same KOTA
tool-runner path used by the core loop. OpenRouter and local model runs inherit
MCP tools, project `.kota/mcp.json`, per-run `mcpServers`, passive/supervised/
autonomous enforcement, approval queue behavior, guardrails, middleware,
idempotency, telemetry, result truncation, read-only parallel execution, and
failure recovery.

## Constraints

- Do not create a second tool runner for `openai-tools`; use the shared
  `executeToolCalls` behavior.
- Preserve `ask_owner` behavior and allowed/disallowed/canUseTool semantics.
- Initialize and close MCP managers through the same lifecycle rules as the
  core loop, including project config plus run-provided servers.
- `autonomyMode: "supervised"` must queue or resolve non-safe tools through
  KOTA approval mechanisms, not provider-native prompts.
- Workflow validation must become capability-based. Do not keep the global
  "workflow agent steps cannot be supervised" rejection once this harness can
  route approvals through KOTA.
- Safety regressions block completion even if basic tool-calling tests pass.

## Done When

- `openai-tools` no longer directly calls `executeTool` for model-emitted tool
  calls.
- `mcpServers` are supported for `openai-tools` using KOTA-owned MCP hosting.
- `autonomyMode: "passive"`, `"supervised"`, and `"autonomous"` behave the
  same way for `openai-tools` as for the shared KOTA tool runner contract.
- Guardrail deny, queue, confirm, client approval, and approval-queue paths are
  covered by cross-harness tests.
- Read-only tool batches can execute concurrently while mutating tools remain
  ordered barriers.
- Tool telemetry, idempotency metadata, result truncation, and secret masking
  are present in `openai-tools` tool results.

## Source / Intent

The code audit found that the harness capability gap is larger than model
choice. Public GLM/Kimi benchmarks are usually model-plus-harness results; KOTA
must make its own harness path strong before model comparisons are meaningful.
This task closes the most important difference between "the model can call
tools" and "the model can safely operate inside KOTA."

## Initiative

OpenRouter/local model parity for KOTA autonomy.

## Acceptance Evidence

- `pnpm test src/core/tools/tool-runner.test.ts src/mcp-servers-cross-harness.integration.test.ts src/rails-cross-harness.integration.test.ts src/autonomy-mid-run.integration.test.ts` passes, with updated expectations showing `openai-tools` support instead of rejection where appropriate.
- A focused `openai-tools` integration test shows an MCP tool call, a queued
  supervised approval, a guardrail denial, and a read-only parallel batch using
  the shared runner.
