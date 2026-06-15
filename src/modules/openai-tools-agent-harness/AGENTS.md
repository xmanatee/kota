# OpenAI Tools Agent Harness Module

Adapter module that registers the `openai-tools` harness: a multi-turn
tool-calling loop driven by any OpenAI-compatible `ModelClient`. Operators
select it through `KotaConfig.defaultAgentHarness`, per-step `harness`, or
`--harness openai-tools`.

This module owns the `KotaTool` to OpenAI-tools native-loop translation at the
adapter seam.

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

Guardrails are applied inside the loop. Filtered tools are hidden and denied if
called; `canUseTool` can update inputs, return a denial tool result, or
interrupt the run.

The adapter additionally rejects a bare `claude_code` preset `systemPrompt`
without an `append` body because that shape is Claude-specific. Portable
`append` text is accepted for operator CLI paths.

## Reasoning Effort

`AgentHarnessRunOptions.effort` is forwarded to `ModelClient.messages.stream`.
Provider-specific translation lives in `model-clients/reasoning.ts`.

## Protocol Errors

Malformed `tool_use` blocks, missing names, and non-object inputs throw before
reaching tool runners. Coercion belongs at the wire boundary only.
