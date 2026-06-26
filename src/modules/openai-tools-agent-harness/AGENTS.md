# OpenAI Tools Agent Harness Module

Adapter module that registers the `openai-tools` harness: a multi-turn
tool-calling loop driven by any OpenAI-compatible `ModelClient`. Select it with
the `openai-tools` preset, default harness config, or a per-step `harness`.

This module owns the `KotaTool` to OpenAI-tools native-loop translation at the
adapter seam. Tool execution routes through the shared KOTA tool runner so
guardrails, approvals, idempotency, effect-aware scheduling, MCP dispatch, and
secret masking stay aligned with the classic loop.

## Supported Providers

Provider coverage comes from `model-clients`. Any resolved client whose
`messages.stream` implementation returns `tool_use` blocks works here:
`openai`, `ollama`, `groq`, `together`, `lmstudio`, and explicit compatible
`--base-url` endpoints.

## Loop Shape

Each turn sends the full `KotaMessage[]` transcript plus the filtered tool list
through `ModelClient.messages.stream`, forwards streamed text, validates tool
calls, executes them through guarded core tool paths, appends `tool_result`
messages, and repeats until no tool calls remain or the max turn limit fires.

Guardrails are applied inside the shared runner. Filtered tools are hidden and
denied if called; `canUseTool` can update inputs, return a denial tool result,
or interrupt the run. Non-empty `mcpServers` are hosted by a KOTA-owned
`McpManager` for stdio/http transports; unsupported transports fail at the
adapter boundary.

The adapter additionally rejects a bare `claude_code` preset `systemPrompt`
without an `append` body because that shape is Claude-specific. Portable
`append` text is accepted for operator CLI paths.

## Reasoning Effort

`AgentHarnessRunOptions.effort` is forwarded to `ModelClient.messages.stream`.
Provider-specific translation lives in `model-clients/reasoning.ts`.

## Protocol Errors

Malformed `tool_use` blocks, missing names, and non-object inputs throw before
reaching tool runners. Coercion belongs at the wire boundary only.
