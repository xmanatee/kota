# OpenAI Tools Agent Harness Module

Adapter module that registers the `openai-tools` harness — a multi-turn
tool-calling loop driven by any OpenAI-compatible ModelClient
(`createModelClient` from the `model-clients` module). Operators select it
via `KotaConfig.defaultAgentHarness: "openai-tools"`, per-step `harness`,
or the `--harness openai-tools` CLI flag.

This module owns the `KotaTool` ↔ OpenAI-tools native-loop tool-definition
translation at the adapter seam (see `src/core/agent-harness/AGENTS.md`).

## Supported Providers

The adapter inherits provider coverage from `model-clients`. Any
ModelClient resolved by `createModelClient` whose `messages.stream`
implementation returns `tool_use` blocks works here. Out of the box that
includes the `openai`, `ollama`, `groq`, `together`, and `lmstudio`
presets, plus any explicit `--base-url` against a compatible endpoint.

## Loop Shape

Each turn:

1. The adapter sends the running `KotaMessage[]` plus the filtered tool
   list through `ModelClient.messages.stream`; `model-clients/openai`
   translates the neutral transcript to OpenAI chat-completion shapes at
   its seam.
2. Streamed `text` deltas flow to the optional `AgentHarnessWriter` so
   operators see live output.
3. The final `KotaModelResponse` is split into text and `tool_use` blocks.
4. If there are no tool calls (or `stop_reason === "end_turn"`), the loop
   returns the latest text.
5. Otherwise each tool call is validated, gated, executed, and its result
   appended to the conversation as a `tool_result` user message before the
   next turn.

The loop ends when the model returns no tool calls, when an
`interrupt: true` denial fires, or when `maxTurns` (default 25) is
reached.

## Guardrail Application

Guardrails are applied **inside the loop**, never delegated:

- `disallowedTools` and `allowedTools` are enforced both as the tool list
  exposed to the model and as a runtime denial when the model attempts a
  filtered tool. A filtered call returns an `is_error: true` tool_result
  rather than executing.
- `canUseTool` is invoked for every model-issued tool call. The callback
  receives an `AbortSignal` linked to `options.abortController?.signal`.
  - `behavior: "allow"` proceeds; an `updatedInput` plain object replaces
    the model's input.
  - `behavior: "deny"` (without `interrupt`) feeds the denial back to the
    model as a tool_result so the model can adapt next turn — this matches
    the SDK's `agent-commit-guard` semantics.
  - `behavior: "deny"` with `interrupt: true` ends the loop with
    `isError: true` and `subtype: "interrupted_by_can_use_tool"`. This is
    the path the daemon-host control guard relies on.
- Higher-level middleware (injection-defense screening of tool payloads,
  guardrails-policy gating, autonomy-mode queueing) lives **above** the
  harness via `executeToolCalls` paths and through `runAgentHarness` hooks
  — the adapter never re-implements those policies.

## Rejected Options

The adapter rejects unsupported neutral options at the boundary rather
than silently ignoring them:

- `mcpServers` (would require a parallel MCP host)
- `autonomyMode === "supervised"` (no operator-approval-queue routing)
- `harnessOverrides` of any shape (no per-step adapter fragment)
- `persistSession: true`
- `enableFileCheckpointing: true`
- `thinkingEnabled: true`
- `onMessage` (no `KotaAgentMessage` frames are emitted)
- A bare `claude_code` preset `systemPrompt` (no `append`); when the preset
  carries an `append` body the adapter uses that portable text so operator
  CLI paths (`kota run -i --harness openai-tools`) keep working without
  coupling the CLI to harness-specific prompt shapes

Operators that need any of these run the `claude-agent-sdk` harness
instead. Callers avoid tripping these rejections by consulting the
adapter-declared capabilities (`emitsAgentMessageStream`,
`askOwnerToolName`) before wiring an option path that depends on a
harness-specific feature.

## Declared Capabilities

- `askOwnerToolName = "ask_owner"` — the tool is hosted directly through
  the core tool registry, not via MCP. When `AgentHarnessRunOptions.askOwner`
  is set, the adapter wraps its loop in `runWithAskOwnerSource(source, ...)`
  so `runAskOwner` reads the correct source from the async-local storage
  context without the adapter referencing the tool's runner directly.
- `emitsAgentMessageStream = false` — the adapter does not produce
  `KotaAgentMessage` frames, so callers must not subscribe through
  `onMessage`. The step-executor guards its tool telemetry wrapper on this
  flag so openai-tools runs do not trigger the `onMessage` rejection.

## Reasoning Effort Passthrough

The adapter forwards `AgentHarnessRunOptions.effort` verbatim to the
resolved `ModelClient.messages.stream` call. Translation from the KOTA
`AgentEffort` enum to the provider's wire shape lives on the preset, not
on the adapter — see `src/modules/model-clients/reasoning.ts` for the
mapping functions.

- Reasoning-capable presets translate `effort` at the wire boundary:
  `openai` emits `reasoning.effort`, `anthropic-oai` and the native
  `anthropic` provider emit `thinking: { type: "enabled", budget_tokens }`.
- Presets without a reasoning mapping (`ollama`, `groq`, `together`,
  `lmstudio`, and any operator-provided `--base-url` without a preset
  entry) throw loudly naming the preset and pointing at `claude-agent-sdk`
  rather than silently running at the provider's default reasoning budget.
- `thinkingEnabled: true` / `thinkingBudget` remain rejected up-front. The
  `effort` field is the canonical KOTA reasoning control; the claude-
  specific `thinking` toggle belongs to the `claude-agent-sdk` harness.

## Multi-Turn Context

The harness drives a fresh stream per turn but feeds the entire
`KotaMessage[]` history each call, so prior assistant text and
tool_result blocks persist across turns. The harness-neutral REPL
composes a transcript prompt and delivers it through `run()`, so
interactive sessions work without the adapter owning native conversation
state.

## Protocol Errors

A model-emitted `tool_use` whose `function.arguments` cannot be parsed as
JSON shows up as `{ _raw: "<original>" }` after `model-clients` wire
translation. The adapter detects that marker (and missing names, non-
object inputs) and throws loudly rather than passing garbage to a tool
runner. Coercion is only acceptable at the wire boundary; once data
crosses into the loop it must be valid.
