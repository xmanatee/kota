# Gemini Agent Harness Module

Adapter module that registers the `gemini` harness — a multi-turn
tool-calling loop driven by the Google Gen AI SDK
(`@google/genai`'s `models.generateContentStream` plus a tool catalog
expressed as `functionDeclarations`). Operators select it via
`KotaConfig.defaultAgentHarness: "gemini"`, per-step `harness`, or the
`--harness gemini` CLI flag.

This module owns the `KotaTool` ↔ Gemini `FunctionDeclaration` translation
at the adapter seam (see `src/core/agent-harness/AGENTS.md`).

## Provider Routing

Models are passed through verbatim to the SDK. Gemini ships only Google
models, so there is no `<provider>/<modelId>` prefix to disambiguate —
operators name the model directly (`gemini-2.5-flash`,
`gemini-2.5-pro`, `gemini-2.0-flash`, …). Authentication is handled by
the SDK itself, which reads `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) from
the process environment when the adapter constructs `new GoogleGenAI({})`.
The adapter does not surface API-key configuration; operators export the
env var.

This module does not use `model-clients`. Gemini's wire shape (the
`functionDeclarations` tool contract, `Content`/`Part` transcript
shape, `functionResponse` round-trip) is its own primitive, parallel to
the OpenAI-chat-completions wire that backs the `openai-tools` adapter.
The `model-clients` registry has no Gemini preset and would require a
fundamentally different translation layer to grow one.

## Loop Shape

The adapter drives the loop itself; the SDK does not run an internal
tool loop on the client side. Each turn:

1. Build a Gemini `Tool[]` from the filtered KOTA tool catalog. Each
   `KotaTool` becomes one `FunctionDeclaration` whose
   `parametersJsonSchema` is the tool's KOTA `input_schema` (already a
   JSON Schema `object`).
2. Call `client.models.generateContentStream({ model, contents, config })`
   with the running `Content[]` transcript and a
   `GenerateContentConfig` carrying `systemInstruction`, `tools`,
   `thinkingConfig`, and the abort signal.
3. Iterate the streamed `GenerateContentResponse` chunks. Text parts
   forward to the optional `AgentHarnessWriter` so operators see live
   output; the adapter aggregates every emitted part into a single
   assistant `Content` for the next turn.
4. After the stream ends, if the assistant content carries no
   `functionCall` parts (or the last chunk's candidate `finishReason`
   is `STOP`), return the latest text as the final result.
5. Otherwise dispatch every emitted `functionCall` through the core
   tool registry under guardrails (see "Guardrail Application"), append
   the assistant turn and a `user` turn carrying the matching
   `functionResponse` parts to the transcript, and continue.

The loop ends when the model returns a function-call-free turn, when
an `interrupt: true` denial fires, or when `maxTurns` (default 25) is
reached.

Multi-turn interactive use (REPL/delegate) works because the
harness-neutral REPL composes a transcript-shaped prompt and delivers
it through `run()`, so the adapter does not own native session state.

## Guardrail Application

Guardrails are applied **inside the loop**, never delegated:

- `disallowedTools` and `allowedTools` are enforced both as the tool
  catalog exposed to the model (filtered before translation to
  `functionDeclarations`) and as a runtime denial when the model
  attempts a filtered tool. A filtered call returns a
  `functionResponse` whose body carries `{ error: "..." }` rather than
  executing.
- `canUseTool` is invoked for every model-issued function call. The
  callback receives an `AbortSignal` linked to
  `options.abortController?.signal`.
  - `behavior: "allow"` proceeds; an `updatedInput` plain object
    replaces the model's args.
  - `behavior: "deny"` (without `interrupt`) feeds the denial back as a
    `functionResponse` body so the model can adapt next turn.
  - `behavior: "deny"` with `interrupt: true` ends the loop with
    `isError: true` and `subtype: "interrupted_by_can_use_tool"`. This
    is the path `agent-commit-guard` and `daemon-host-control-guard`
    rely on.
- Higher-level middleware (injection-defense screening of tool
  payloads, guardrails-policy gating, autonomy-mode queueing) lives
  **above** the harness via `executeToolCalls` paths and through
  `runAgentHarness` hooks — the adapter never re-implements those
  policies.

## Rejected Options

The adapter rejects unsupported neutral options at the boundary rather
than silently ignoring them:

- `mcpServers` (would require a parallel MCP host)
- `autonomyMode === "supervised"` (no operator-approval-queue routing)
- `harnessOverrides` of any shape (no per-step adapter fragment)
- `persistSession: true`
- `resumeSessionId`
- `enableFileCheckpointing: true`
- `thinkingEnabled: true` / `thinkingBudget` (use the portable
  `effort` field — gemini maps it to `thinkingConfig.thinkingLevel`)
- `onMessage` (no `KotaAgentMessage` frames are emitted)

Operators that need any of these run the `claude-agent-sdk` harness
instead.

## Declared Capabilities

- `askOwnerToolName = "ask_owner"` — the tool is hosted directly
  through the core tool registry, not via the SDK's MCP support. When
  `AgentHarnessRunOptions.askOwner` is set, the adapter wraps its loop
  in `runWithAskOwnerSource(source, ...)` so `runAskOwner` reads the
  correct source from the async-local storage context without the
  adapter referencing the tool's runner directly.
- `emitsAgentMessageStream = false` — the adapter does not produce
  `KotaAgentMessage` frames, so callers must not subscribe through
  `onMessage`. The step-executor guards its tool telemetry wrapper on
  this flag so gemini runs do not trigger the `onMessage` rejection.

## Reasoning Effort Passthrough

`AgentHarnessRunOptions.effort` is mapped to Gemini's
`GenerateContentConfig.thinkingConfig.thinkingLevel` at adapter scope.
Translation lives at this seam (not on a shared preset table) because
the Gemini adapter is its own wire path — `model-clients/reasoning.ts`
covers the model-clients-based adapter only.

- `low` → `{ thinkingLevel: "LOW" }`
- `medium` → `{ thinkingLevel: "MEDIUM" }`
- `high` / `xhigh` / `max` → `{ thinkingLevel: "HIGH" }`

The adapter never silently disables thinking; operators that want a
zero-budget run select a non-thinking-capable Gemini model directly.

## Multi-Turn Context

The adapter drives the SDK's `generateContentStream` once per turn and
re-feeds the entire `Content[]` transcript on each call, so prior
assistant text, `functionCall` parts, and `functionResponse` parts
persist across turns. The harness-neutral REPL composes a
transcript-shaped prompt and delivers it through `run()`, so
interactive sessions work without the adapter owning native
conversation state.

## Protocol Errors

A `functionCall` whose `name` is missing or whose `args` is not a JSON
object throws loudly inside the loop rather than passing garbage to a
tool runner. Coercion is only acceptable at the wire boundary; once
data crosses into the adapter's tool runner it must be a plain object.
