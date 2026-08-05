# Agent Harness Protocol

This is the harness-neutral boundary used by sessions, steps, and delegates
instead of a specific agent runtime. Adapters live in modules; core owns only
the protocol and registry.

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
- Neutral options carry tool risk, live scope policy, commit/daemon guards, and
  injection defense (`scopePolicy`, `getScopePolicySnapshot`, `canUseTool`, MCP
  and tool lists). KOTA-routable loops must honor them; other adapters declare
  them in `unsupportedRunOptions`, so `runAgentHarness` rejects them before
  hooks or launch.
- Nested handoffs and delegates are authorization boundaries: carry both
  policy options; inherited tool lists and `canUseTool` are insufficient.
- `sessionContext` is tool-runtime identity, not workflow trace/span metadata.
  `runAgentHarness` creates one per invocation; persistent interactive callers
  register one outer lifetime and reuse its context through teardown.
- `runAgentHarness` is the cancellation quarantine boundary: after abort or
  settlement it rejects late results and drops callbacks. Native tool loops
  declare confirmed-stop support, register a run-local stop barrier before
  acting, and hold the run until the process can no longer mutate.
- `guards.ts` owns hidden agent/worktree nesting, commit, daemon-control, and
  authority guards. Its OS sandbox gives opaque code and native CLIs minimal
  environments, isolated home/temp, project package-manager runtimes,
  declared auth, readable roots, and provider-only egress via a
  host-owned proxy. Native tools lack direct host, loopback, metadata-service, or internet route.

## Owner-questions capability

Owner questions are a protocol capability, not a provider field.

- `AgentHarnessRunOptions.askOwner` is the neutral request; adapters expose the
  `ask_owner` tool through their native mechanism.
- `askOwnerToolName` declares support. `runAgentHarness` rejects `askOwner`
  before `run()` when the adapter declares `null`.
- `runWithAskOwnerSource` provides per-run attribution through
  `AsyncLocalStorage`.

## Capability flags

- `emitsAgentMessageStream: boolean` — whether the adapter emits
  `KotaAgentMessage` frames to `onMessage`. Adapters without a stream reject
  `onMessage` at the boundary.
- `toolControl: "kota" | "native"` — whether KOTA can route neutral
  tool-control options into the adapter. `"kota"` adapters receive those
  options and either honor or reject them at their own boundary. `"native"`
  adapters own their CLI tool loop, so callers that intentionally use native
  control omit KOTA-only tool options via `routeKotaToolControlOptions`.
- `supportsMultiTurn: boolean` — whether the REPL can launch this adapter.
  Single-shot runners set `false` so the REPL refuses to launch them rather
  than silently downgrading.
- `readiness` — adapter-owned local preflight: adapter kind, runtime and local
  auth probes, optional peer probes, and unsupported options. It makes no
  provider network calls.
- `resolveIsolatedHostAuthEnv` — optional non-secret login-locator projection
  when trusted host runners replace `HOME`; tokens remain outside this contract.
- `unsupportedRunOptions` is enforced before hooks or launch and mirrored in
  readiness. Native CLIs without KOTA's tool gate declare `canUseTool`,
  `allowedTools`, and `disallowedTools`; harnesses bypassing shared policy also
  declare `scopePolicy`.
- Workflows route KOTA-only options through `routeKotaToolControlOptions`.
  Native harnesses use capped autonomy and filesystem/machine-authority
  sandboxes; policy callbacks are errors. Hosted loops refresh
  `getScopePolicySnapshot` per call; native loops abort on stricter revisions.
- `capability-snapshot.ts` centralizes capability/readiness artifacts from
  resolved declarations, not harness-name catalogs. Adapter docs may explain
  rationale, but capability facts stay in code.

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
`stdio | sse | http`; adapters either host those servers through their own
tool-control surface or reject unsupported transports/options at the boundary.
`AgentCanUseTool` / `AgentPermissionResult` are KOTA-shaped
(`toolUseId`, `decisionAttribution` literals); adapters bridge
them to their native shape at their own seam. Nothing in core imports
`@anthropic-ai/claude-agent-sdk`. Harness-specific in-process MCP hosting
stays inside the owning adapter.

Provider SDK-specific knobs do not appear on `AgentHarnessRunOptions`. The
neutral surface carries only KOTA concepts, KOTA's own ModelClient provider
selection (`modelProvider`), and harness-agnostic transport fields. Per-step
adapter-private options travel through `harnessOverrides`, validated by the
resolved adapter and threaded through as opaque `AgentHarnessStepOverrides`.
`no-sdk-shaped-neutral-fields.test.ts` keeps provider-shaped IDs off
the neutral protocol surface.

Nothing in core treats a provider's type surface as its internal protocol.
Every tool, message, block, thinking config, and model response on a core
interface is a KOTA-owned neutral type from `message-protocol.ts`; adapter
modules translate at their seam. `no-anthropic-imports-in-core.test.ts`
enforces this mechanically.

## Per-step harness-specific options

Neutral workflow step shapes carry no harness-specific fields. Per-step
overrides route through the `harnessOptions` passthrough — a single-key
record whose key equals the step's resolved harness name and whose value
is validated by that harness's `validateStepOptions` method. The
validated fragment travels to the adapter via
`AgentHarnessRunOptions.harnessOverrides`. Leaving `harnessOptions`
unset uses each adapter's defaults. New harness-only knobs belong on
`validateStepOptions`, not on the neutral step.
