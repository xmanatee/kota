# Codex Agent Harness Module

Adapter module that registers the `codex` harness — a multi-turn
tool-calling loop driven by the OpenAI Agents SDK
(`@openai/agents`'s `Agent` + `run` + `tool`). The Agents SDK is the
JavaScript surface KOTA uses for OpenAI's Responses API agent loop.
This is not a shell-out to the Codex CLI and does not read Codex CLI
login state. Operators select this harness via
`KotaConfig.defaultAgentHarness: "codex"`, per-step `harness`, or the
`--harness codex` CLI flag.

This module owns the `KotaTool` ↔ Agents SDK `FunctionTool`
translation at the adapter seam (see
`src/core/agent-harness/AGENTS.md`).

## Provider Routing

Models are passed through verbatim to the Agents SDK. The Agents SDK
currently targets OpenAI's Responses API by default, so there is no
`<provider>/<modelId>` prefix to disambiguate — operators name the
model directly (e.g. `gpt-5.5`, `gpt-5.4`,
`gpt-5.4-mini`). Authentication is handled by the SDK's default
`OpenAIProvider`, which reads `OPENAI_API_KEY` from the process
environment when the SDK constructs its underlying `openai` client.
The adapter does not surface API-key configuration; operators export
the env var.

This module does not use `model-clients`. The OpenAI Agents SDK is
its own wire and tool-loop primitive (Responses API items, reasoning
items, function-call items, internal multi-step loop), parallel to
the chat-completions wire that backs the `openai-tools` adapter and
the `model-clients`-based ModelClient registry. A KOTA Codex
deployment runs the Agents SDK directly so it gets Responses-API
behavior (reasoning effort surface, in-SDK tool loop, native
streaming) the chat-completions adapter cannot express.

## Loop Shape

The adapter calls `run(agent, prompt, { stream: true, maxTurns, signal })`
once per `run()`. The Agents SDK runs the multi-step tool loop
internally:

1. Build `FunctionTool[]` from the filtered KOTA tool list. Each
   `FunctionTool.execute` is the guardrail hook — see "Guardrail
   Application".
2. Construct an `Agent` carrying `instructions` (the system prompt),
   `model`, `modelSettings.reasoning.effort`, and the tool list.
3. Pass the user prompt to `run()` with `stream: true` so the adapter
   can iterate the streamed events.
4. Iterate the `RunStreamEvent` async iterator. `output_text_delta`
   raw events carry assistant text deltas — the adapter forwards them
   to the optional `AgentHarnessWriter` so operators see live output.
5. After the iterator drains, the adapter awaits `result.completed`
   and reads `result.finalOutput`, `result.rawResponses` (one entry
   per LLM turn), `result.lastResponseId`, and
   `result.state.runContext.usage` to compose the neutral
   `AgentHarnessResult`.

Multi-turn interactive use (REPL/delegate) works because the
harness-neutral REPL composes a transcript-shaped prompt and
delivers it through `run()`, so the adapter does not own native
session state.

## Guardrail Application

Guardrails are applied **inside the loop**, never delegated:

- `disallowedTools` and `allowedTools` are enforced as the tool
  catalog exposed to the model: tools that fail the filter are not
  added to the `Agent.tools` list, so the SDK never sees them and
  the model cannot attempt them. A defense-in-depth runtime denial
  inside `execute` would be unreachable because `run()` only
  invokes `execute` for tools the agent was given.
- `canUseTool` is invoked for every model-issued tool call. The
  callback receives an `AbortSignal` linked to
  `options.abortController?.signal` and the SDK's call id as
  `toolUseId`.
  - `behavior: "allow"` proceeds; an `updatedInput` plain object
    replaces the model's input.
  - `behavior: "deny"` (without `interrupt`) returns the denial
    message as the tool's output string so the model can adapt next
    turn — same semantics as `vercel`/`openai-tools`.
  - `behavior: "deny"` with `interrupt: true` aborts the harness's
    internal abort controller, ending the loop with `isError: true`
    and `subtype: "interrupted_by_can_use_tool"`. This is the path
    `agent-commit-guard` and `daemon-host-control-guard` rely on.
- Higher-level middleware (injection-defense screening,
  guardrails-policy gating, autonomy-mode queueing) lives **above**
  the harness via `executeToolCalls` paths and `runAgentHarness`
  hooks — the adapter never re-implements those policies.

## Rejected Options

The adapter rejects unsupported neutral options at the boundary
rather than silently ignoring them:

- `mcpServers` (would require a parallel MCP host; the Agents SDK
  ships its own `MCPServer` types but KOTA's neutral `mcpServers`
  field is for claude-agent-sdk's transport variants and routing
  through that here would mix two unrelated host shapes)
- `autonomyMode === "supervised"` (no operator-approval-queue
  routing through the SDK's own `needsApproval`/interruption shape)
- `harnessOverrides` of any shape (no per-step adapter fragment)
- `persistSession: true`
- `enableFileCheckpointing: true`
- `thinkingEnabled: true` / `thinkingBudget` (use the portable
  `effort` field — codex maps it to `modelSettings.reasoning.effort`)
- `onMessage` (no `KotaAgentMessage` frames are emitted)

Operators that need any of these run the `claude-agent-sdk`
harness instead.

## Declared Capabilities

- `askOwnerToolName = "ask_owner"` — the tool is hosted directly
  through the core tool registry, not via the SDK's MCP support.
  When `AgentHarnessRunOptions.askOwner` is set, the adapter wraps
  its loop in `runWithAskOwnerSource(source, ...)` so `runAskOwner`
  reads the correct source from the async-local storage context
  without the adapter referencing the tool's runner directly.
- `emitsAgentMessageStream = false` — the adapter does not produce
  `KotaAgentMessage` frames, so callers must not subscribe through
  `onMessage`. The step-executor guards its tool telemetry wrapper
  on this flag so codex runs do not trigger the `onMessage`
  rejection.

## Reasoning Effort Passthrough

`AgentHarnessRunOptions.effort` is mapped to the Agents SDK's
`ModelSettings.reasoning.effort` field at adapter scope. Translation
lives at this seam (not on a shared preset table) because the
codex adapter is its own wire path — `model-clients/reasoning.ts`
covers the model-clients-based adapter only.

- `low` → `"low"`
- `medium` → `"medium"`
- `high` → `"high"`
- `xhigh` / `max` → `"xhigh"` (the SDK has no `"max"` literal; we
  collapse to its highest value, `xhigh`)

The adapter never silently disables reasoning; operators that want
a non-thinking run select a non-reasoning OpenAI model directly.

## Multi-Turn Context

The adapter drives `run()` once per `run()` call and relies on the
SDK's internal multi-step loop to feed assistant turns,
function-call items, and function-call-output items into the next
turn. Multi-turn interactive use composes a transcript-shaped prompt
at the REPL layer and delivers it through `run()`, so the adapter
does not own native session state. The SDK's `state.history` is
returned to the caller as part of `result` for logging but is not
re-fed across separate `run()` invocations — every interactive turn
is its own SDK run on the freshly composed transcript prompt.

## Protocol Errors

A tool call whose input is not a JSON object after the SDK's own
parameter validation throws loudly inside `execute`. Coercion is
only acceptable at the wire boundary; once data crosses into the
adapter's tool runner it must be a plain object.
