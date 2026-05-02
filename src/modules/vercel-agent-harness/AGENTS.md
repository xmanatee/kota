# Vercel Agent Harness Module

Adapter module that registers the `vercel` harness — a multi-turn
tool-calling loop driven by the Vercel AI SDK (`ai` package's
`streamText` plus `tools` plus `stopWhen: stepCountIs(N)`). Operators
select it via `KotaConfig.defaultAgentHarness: "vercel"`, per-step
`harness`, or the `--harness vercel` CLI flag.

This module owns the `KotaTool` ↔ Vercel `ToolSet` translation at the
adapter seam (see `src/core/agent-harness/AGENTS.md`).

## Provider Routing

Models are addressed as `<providerKey>/<modelId>`. The adapter ships
with a single registered provider key:

- `openai` — backed by `@ai-sdk/openai` (`createOpenAI()`); reads
  `OPENAI_API_KEY` (and any other env the upstream SDK supports) at
  request time. Examples: `openai/gpt-4o-mini`, `openai/gpt-4.1-mini`.

Adding a provider is a one-line registry extension in `adapter.ts`:
install the matching `@ai-sdk/<vendor>` package, import its provider
factory, and add a `<vendor>: (modelId) => createVendor()(modelId)`
entry to `VERCEL_PROVIDER_REGISTRY`. Unknown providers throw at the
boundary — the adapter does not silently fall back. This module does
not use `model-clients`; the Vercel AI SDK is its own wire and tool-
loop primitive, parallel to the `model-clients`-based `openai-tools`
adapter.

## Loop Shape

The adapter calls `streamText` once per `run()`. The Vercel AI SDK
runs the multi-step tool loop internally:

1. Build the Vercel `ToolSet` from the filtered KOTA tool list. Each
   `Tool.execute` is the guardrail hook — see "Guardrail Application".
2. Pass `messages: [{ role: "user", content: prompt }]`, optional
   `system`, the tool set, `stopWhen: stepCountIs(maxTurns)`, and the
   abort signal.
3. The SDK streams text deltas; `onChunk` forwards them to the
   `AgentHarnessWriter` so operators see live output.
4. The SDK finishes when the model returns a `stop` step with no
   pending tool calls or when `stepCountIs(maxTurns)` fires. The
   adapter awaits `result.text`, `result.totalUsage`, `result.steps`,
   and `result.finishReason` to compose the neutral `AgentHarnessResult`.

Multi-turn interactive use (REPL/delegate) works because the SDK
accepts a multi-message transcript on the `messages` field and the
neutral REPL composes that transcript before delivery via `run()`.

## Guardrail Application

Guardrails are applied **inside the loop**, never delegated:

- `disallowedTools` and `allowedTools` are enforced as the tool
  catalog exposed to the model. Tools that fail the filter are not
  added to the Vercel `ToolSet`, so the SDK never sees them and the
  model cannot attempt them; a defense-in-depth runtime denial inside
  `execute` would be unreachable because `streamText` only invokes
  `execute` for tools it was given.
- `canUseTool` is invoked for every model-issued tool call. The
  callback receives an `AbortSignal` linked to
  `options.abortController?.signal`.
  - `behavior: "allow"` proceeds; an `updatedInput` plain object
    replaces the model's input.
  - `behavior: "deny"` (without `interrupt`) feeds the denial back as
    an error tool result so the model can adapt next turn — same
    semantics as `openai-tools`.
  - `behavior: "deny"` with `interrupt: true` aborts the harness's
    internal abort controller, ending the loop with `isError: true`
    and `subtype: "interrupted_by_can_use_tool"`. This is the path
    `agent-commit-guard` and `daemon-host-control-guard` rely on.
- Higher-level middleware (injection-defense screening, guardrails-
  policy gating, autonomy-mode queueing) lives **above** the harness
  via `executeToolCalls` paths and `runAgentHarness` hooks — the
  adapter never re-implements those policies.

## Rejected Options

The adapter rejects unsupported neutral options at the boundary
rather than silently ignoring them:

- `mcpServers` (would require a parallel MCP host)
- `autonomyMode === "supervised"` (no operator-approval-queue routing)
- `harnessOverrides` of any shape (no per-step adapter fragment)
- `persistSession: true`
- `enableFileCheckpointing: true`
- `thinkingEnabled: true` / `thinkingBudget` (use the portable
  `effort` field)
- `onMessage` (no `KotaAgentMessage` frames are emitted)

Operators that need any of these run the `claude-agent-sdk` harness
instead.

## Declared Capabilities

- `askOwnerToolName = "ask_owner"` — the tool is hosted directly
  through the core tool registry, not via MCP. When
  `AgentHarnessRunOptions.askOwner` is set, the adapter wraps its
  loop in `runWithAskOwnerSource(source, ...)` so `runAskOwner` reads
  the correct source from the async-local storage context without
  the adapter referencing the tool's runner directly.
- `emitsAgentMessageStream = false` — the adapter does not produce
  `KotaAgentMessage` frames, so callers must not subscribe through
  `onMessage`. The step-executor guards its tool telemetry wrapper on
  this flag so vercel runs do not trigger the `onMessage` rejection.

## Reasoning Effort Passthrough

`AgentHarnessRunOptions.effort` is mapped to provider-native
reasoning settings on `streamText.providerOptions` at adapter scope.
Translation lives at this seam (not on a shared preset table) because
the Vercel adapter is its own wire path — `model-clients/reasoning.ts`
covers the model-clients-based adapter only.

- `openai`: `effort` → `providerOptions.openai.reasoningEffort`,
  collapsing `low`, `medium`, `high`/`xhigh`/`max` to OpenAI's three
  reasoning levels (`low`, `medium`, `high`).
- Adding a provider also adds its mapping. Unsupported providers
  throw loudly naming the provider and pointing at `claude-agent-sdk`.

## Multi-Turn Context

The adapter drives `streamText` once per `run()` call and feeds the
prompt through the SDK's internal multi-step loop. Multi-turn
interactive use composes a transcript-shaped prompt at the REPL layer
and delivers it through `run()`, so the adapter does not own native
session state.

## Protocol Errors

A tool call whose input is not a JSON object after the SDK's
`inputSchema` validation throws loudly inside `execute`. Coercion is
only acceptable at the wire boundary; once data crosses into the
adapter's tool runner it must be a plain object.
