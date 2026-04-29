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
  `src/core/loop/`. Harness-neutral callers never build provider-native wire
  shapes; adapters that want to wrap the text in a native envelope do the
  wrapping inside the adapter. `AgentSystemPrompt = string` is the contract
  every adapter consumes.
- Streaming text goes through the optional `writer` so operators see live
  output regardless of which harness runs.
- Tool risk gating, commit guards, daemon control guards, and injection-defense
  middleware are passed into the harness through standard fields
  (`canUseTool`, `mcpServers`, tool allow/deny lists). Every adapter must
  apply them; `src/rails-cross-harness.integration.test.ts`,
  `src/abort-cross-harness.integration.test.ts`, and
  `src/mcp-servers-cross-harness.integration.test.ts` enforce parity.
- `guards.ts` hosts the harness-neutral `canUseTool` primitives
  (`createAgentCommitGuard`, `createDaemonHostControlGuard`,
  `composeCanUseTools`, `createWorkflowAgentGuards`). Callers reach for
  `createWorkflowAgentGuards()` so the same behavior applies across every
  registered tool-loop adapter.

## Owner-questions capability

Owner-questions surface is a protocol-owned capability, not a provider field
injected by call sites.

- `AgentHarnessRunOptions.askOwner?: { source: string }` is the neutral
  request. The adapter is responsible for making the `ask_owner` tool
  reachable to the agent using its native mechanism.
- Each adapter declares `askOwnerToolName: string | null`. `null` means the
  adapter cannot host the surface; `runAgentHarness` throws before calling
  `run()` if a caller sets `askOwner` against such an adapter.
- Per-run source attribution flows through an `AsyncLocalStorage` context
  set by `runWithAskOwnerSource` in `src/core/tools/ask-owner.ts`.

## Capability flags

- `emitsAgentMessageStream: boolean` — whether the adapter emits
  `KotaAgentMessage` frames to `onMessage`. Adapters without a stream reject
  `onMessage` at the boundary.
- `supportsMultiTurn: boolean` — whether the REPL can launch this adapter.
  Single-shot runners set `false` so the REPL refuses to launch them rather
  than silently downgrading.

## Registry and selection

- `registerAgentHarness(harness)` registers an adapter under its declared
  `name`. Modules register during load. The core never registers adapters.
- `resolveAgentHarness(name)` returns the adapter or throws with the list of
  currently registered names. There is no implicit default.
- Workflow steps declare `harness`, or inherit from
  `KotaConfig.defaultAgentHarness`. Shipped workflows may declare an explicit
  harness so the repo boots without operator-local config. Judges inside an
  agent step's repair loop read the parent step's resolved `step.harness`.

## Lifecycle hooks (harness-neutral)

`hooks.ts` owns the neutral lifecycle hook surface. Modules register
`preRun`/`postRun` hooks through `ctx.registerHarnessHook`; callers invoke
adapters through `runAgentHarness(harness, options, writer)`. The entry point
dispatches every registered hook of a supported kind around the adapter's
native run, and throws if a hook kind is registered that the adapter does not
list in `supportedHookKinds`.

`src/core/loop/pre-send-hooks.ts` is a separate classic-loop surface
(architect module). New cross-adapter decoration uses the neutral harness
hook, not that.

## Neutral wire-type declarations

`types.ts` declares the KOTA-native neutral run options and
`agent-message.ts` declares the strict discriminated `KotaAgentMessage`
union every adapter normalizes into. `AgentMcpServerConfig` is
`stdio | sse | http`; non-claude adapters reject non-empty `mcpServers` at
the boundary. `AgentCanUseTool` / `AgentPermissionResult` are KOTA-shaped
(`toolUseId`, `decisionAttribution` literals); the claude adapter bridges
them to the SDK shape at its own seam. Nothing in core imports
`@anthropic-ai/claude-agent-sdk`. Harness-specific in-process MCP hosting
stays inside the owning adapter.

Provider-specific knobs do not appear on `AgentHarnessRunOptions`. The
neutral surface carries only KOTA concepts (autonomy posture, prompt,
tools, effort, owner-questions, abort) plus harness-agnostic transport
fields (cwd, model name, max turns, system prompt). Per-step
adapter-private options travel through `harnessOverrides`, validated by
the resolved adapter's `validateStepOptions` and threaded through as an
opaque `AgentHarnessStepOverrides` (typed as `unknown` at the protocol
boundary). `no-sdk-shaped-neutral-fields.test.ts` is the regression
guard: a future contributor cannot re-introduce a banned provider-shaped
identifier on the neutral protocol surface without turning the test red.

The invariant is stronger than "core doesn't import the claude SDK":
*nothing in core treats a provider's type surface as its internal
protocol*. Every tool, message, block, thinking config, and model
response on a core interface is a KOTA-owned neutral type from
`message-protocol.ts`; adapter modules translate at their seam.
`no-anthropic-imports-in-core.test.ts` enforces this mechanically.

## Per-step harness-specific options

Neutral workflow step shapes carry no harness-specific fields. Per-step
overrides route through the `harnessOptions` passthrough — a single-key
record whose key equals the step's resolved harness name and whose value
is validated by that harness's `validateStepOptions` method. The
validated fragment travels to the adapter via
`AgentHarnessRunOptions.harnessOverrides`. Leaving `harnessOptions`
unset uses each adapter's defaults. New harness-only knobs belong on
`validateStepOptions`, not on the neutral step.
