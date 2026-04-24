# Agent Harness Protocol

This directory hosts the harness-neutral boundary the session/step/delegate
layer calls instead of invoking a specific agent runtime (Claude Agent SDK,
OpenAI codex, thin ModelClient loop, etc.). Adapters that implement this
protocol live in modules — the core only owns the interface and the registry.

## Protocol

- `AgentHarness.run(options, writer?)` takes a prompt plus neutral options and
  returns a typed result (text, tokens, turns, subtype, isError, sessionId).
- A harness must not silently coerce unsupported options. If an adapter cannot
  honor a requested option (for example a tools list against a text-only
  harness), it should fail loudly at the boundary.
- `AgentHarnessRunOptions.systemPrompt` is a plain string of portable KOTA
  system-prompt content composed by `buildKotaSystemPrompt` in
  `src/core/loop/`. Harness-neutral callers never build claude-SDK wire
  shapes; adapters that want to wrap the text in a native envelope (e.g. the
  claude-agent-sdk `claude_code` preset) do the wrapping inside the adapter.
  `AgentSystemPrompt = string` is the contract every adapter consumes.
- Streaming text goes through the optional `writer` so operators see live
  output regardless of which harness runs.
- Tool risk gating, commit guards, daemon control guards, and injection-defense
  middleware are passed into the harness through standard fields
  (`canUseTool`, `mcpServers`, tool allow/deny lists). Every adapter must
  apply them; callers should not assume an adapter can skip them.
- `guards.ts` hosts the harness-neutral `canUseTool` primitives
  (`createAgentCommitGuard`, `createDaemonHostControlGuard`,
  `composeCanUseTools`, `createWorkflowAgentGuards`). Callers that need the
  standard workflow-agent stack reach for `createWorkflowAgentGuards()` so
  the same behavior applies across claude-agent-sdk, openai-tools, and any
  future tool-loop adapter — guards are not re-imported from the
  claude-agent-harness module.

## Owner-questions capability

Owner-questions surface is a protocol-owned capability, not a claude-SDK
field injected by call sites.

- `AgentHarnessRunOptions.askOwner?: { source: string }` is the neutral
  request. When a caller passes it, the adapter is responsible for making
  the `ask_owner` tool reachable to the agent using its native mechanism.
- Each adapter declares `askOwnerToolName: string | null`. The string is
  the runtime tool name the agent sees in its catalog (e.g.
  `mcp__kota_owner_questions__ask_owner` on claude,
  `ask_owner` on openai-tools). `null` means the adapter cannot host the
  surface; `runAgentHarness` throws before calling `run()` if a caller
  sets `askOwner` against such an adapter. Owner-questions must not
  silently degrade when an operator switches harness.
- Per-run source attribution flows through an `AsyncLocalStorage` context
  set by `runWithAskOwnerSource` in `src/core/tools/ask-owner.ts`. The
  openai-tools adapter wraps its tool loop in this context; the claude
  adapter relies on its MCP server wrapper (which accepts `source`
  explicitly) for the same effect.

## Capability flags

- `emitsAgentMessageStream: boolean` — whether the adapter emits `AgentMessage`
  frames to `onMessage`. Callers check before subscribing; adapters without a
  stream (openai-tools, thin) reject `onMessage` at the boundary.
- `supportsMultiTurn: boolean` — whether the REPL can launch this adapter.
  Adapters that honor a prompt plus prior-turn context set `true`;
  fundamentally single-shot runners set `false` so the REPL refuses to
  launch them rather than silently downgrading.

## Registry and selection

- `registerAgentHarness(harness)` registers an adapter under its declared
  `name`. Modules register during load. The core never registers adapters.
- `resolveAgentHarness(name)` returns the adapter or throws with the list of
  currently registered names. There is no implicit default — failing to select
  a harness is a loud error, never a silent fallback to claude-agent-sdk.
- Call sites resolve a harness per run: workflow steps declare
  `harness`, or inherit from `KotaConfig.defaultAgentHarness` at the top level.
  The operator picks which adapter is the default for their environment.
- Shipped workflows may declare an explicit harness when the repo must boot
  without operator-local config. Judges inside an agent step's repair loop
  read the parent step's resolved `step.harness`, not a parallel config loader.

## Lifecycle hooks (harness-neutral)

`src/core/agent-harness/hooks.ts` owns the neutral lifecycle hook surface.
Modules register `preRun` or `postRun` hooks through `ctx.registerHarnessHook`;
callers invoke adapters through `runAgentHarness(harness, options, writer)`
instead of calling `harness.run()` directly. The entry point dispatches every
registered hook of a supported kind around the adapter's native run.

- `preRun` fires before the adapter's `run()` with `{ harness, options }`.
- `postRun` fires after the adapter's `run()` returns with
  `{ harness, options, result }`.

Adapters declare which kinds they can host through
`AgentHarness.supportedHookKinds`. `runAgentHarness` inspects that list: if a
module registers a hook whose kind is not in the adapter's supported set, the
entry point throws loudly — same rule as `thin-agent-harness` rejecting tool
options it cannot host.

`src/core/loop/pre-send-hooks.ts` is a separate classic-loop surface
(architect module) exposing ModelClient/history/CostTracker/Transport.
New cross-adapter decoration uses the neutral harness hook, not that.

## Neutral wire-type declarations

`types.ts` declares the neutral wire frames every harness adapter
normalizes into — `AgentMessage` (with variants `AgentAssistantMessage`,
`AgentResultMessage`, `AgentStatusMessage`, `AgentContentBlock`,
`AgentMessageWithSession`), `AgentPermissionMode`, `AgentSettingSource`,
`AgentEffort`, `AgentMcpServerConfig` (`stdio | sse | http`; non-claude
adapters reject non-empty `mcpServers` at the boundary), and
`AgentCanUseTool` / `AgentPermissionResult` (structurally aligned with
the Claude SDK so guards flow through with one cast). These shapes
originated with the Claude Agent SDK but the protocol treats them as
neutral; nothing in core imports the claude-agent-sdk package.
Harness-specific in-process MCP hosting (the claude-only `sdk` variant)
stays inside the owning adapter.

Claude-SDK-specific query shapes (`SDKQueryOptions`, `SDKSystemPrompt`,
`SDKThinkingConfig`, `SDKQueryParams`, `SDKQueryFn`, `SDKModule`), the
executor primitive, and the owner-questions MCP bridge live in
`src/modules/claude-agent-harness/`.

The target is stronger than "core doesn't import the claude-agent-
sdk": *nothing in core treats the Anthropic SDK type surface as its
internal protocol*. Tool shapes are now `KotaTool` /
`KotaToolInputSchema` in `message-protocol.ts`; message/thinking
shapes follow in later stages. See `anthropic-type-audit.md`.

## Per-step harness-specific options

Neutral workflow step shapes carry no harness-specific fields. Per-step
overrides route through the `harnessOptions` passthrough — a single-key
record whose key must equal the step's resolved harness name and whose
value is validated by that harness's `validateStepOptions` method:

```ts
{ type: "agent", harness: "claude-agent-sdk",
  harnessOptions: {
    "claude-agent-sdk": { permissionMode: "acceptEdits", settingSources: ["project"] },
  } }
```

The harness validator throws on malformed input and returns a
`Partial<AgentHarnessRunOptions>` fragment the executor merges into the
run options. The core validator rejects mismatched keys, unknown
harnesses, and harnesses that declare no `validateStepOptions`. Leaving
`harnessOptions` unset uses each adapter's defaults. New harness-only
knobs belong on `validateStepOptions`, not on the neutral step.
