# Agent Harness Protocol

This is the harness-neutral boundary used by sessions, steps, and delegates
instead of a specific agent runtime. Adapters live in modules; core owns only
the protocol and registry.

## Protocol

- `AgentHarness.run(options, writer?)` takes neutral options and returns a typed
  result (text, tokens, turns, subtype, isError, sessionId).
- A harness must not silently coerce unsupported options. If an adapter cannot
  honor a requested option (for example a tools list against a text-only
  harness), it should fail loudly at the boundary.
- `AgentHarnessRunOptions.systemPrompt` is a plain string of portable KOTA
  system-prompt content composed by `buildKotaSystemPrompt` in
  `src/core/loop/`. Harness-neutral callers never build provider-native wire
  shapes; adapters that want to wrap the text in a native envelope do the
  wrapping inside the adapter. `AgentSystemPrompt = string` is the contract
  every adapter consumes.
- The optional `writer` streams text to operators across every harness.
- Neutral options carry tool risk, live scope policy, commit/daemon guards, and
  injection defense (`scopePolicy`, `getScopePolicySnapshot`, `canUseTool`, MCP
  and tool lists). KOTA-routable loops must honor them; other adapters declare
  them in `unsupportedRunOptions`, so `runAgentHarness` rejects them before
  hooks or launch.
- Harnesses enforce `AgentDef.writeScope` before project mutation; Git checks
  backstop it. Workflow agents receive one separately propagated per-run output
  directory, never the canonical run directory containing runtime state.
- Nested handoffs and delegates are authorization boundaries: carry both
  policy options; inherited tool lists and `canUseTool` are insufficient.
- `sessionContext` is tool-runtime identity, not workflow trace/span metadata.
  `runAgentHarness` creates one per invocation; persistent interactive callers
  register one outer lifetime and reuse its context through teardown.
- `runAgentHarness` quarantines cancellation: after abort/settlement it rejects
  late results and callbacks. Native tool loops register a confirmed-stop
  barrier. Each native launch uses `createNativeAgentInvalidationLifecycle` for
  child/parent abort propagation, restrictive policy, and idempotent cleanup;
  nested launches reuse it.
- `guards.ts` owns hidden agent/worktree nesting, commit, daemon-control, and
  authority guards. Its OS sandbox gives opaque code and native CLIs minimal
  environments, isolated home/temp, project package-manager runtimes,
  declared auth/read roots, and provider-only egress through a host-owned proxy.
  Native tools lack direct host, loopback, metadata-service, or internet routes.
  KOTA native sandboxes protect `.kota`; only validated `KOTA_RUN_DIR` /
  `KOTA_RUN_TEMP_DIR` evidence and temp paths are writable.
- Runtime Probes and production proofs use the fail-closed contained-workspace sandbox; never add an unsandboxed launcher.

## Owner-questions capability

Owner questions are a protocol capability, not a provider field.

- `AgentHarnessRunOptions.askOwner` is the neutral request; adapters expose the
  `ask_owner` tool through their native mechanism.
- `askOwnerToolName` declares support. `runAgentHarness` rejects `askOwner`
  before `run()` when the adapter declares `null`.
- `runWithAskOwnerSource` provides per-run attribution.

## Capability flags

- `emitsAgentMessageStream` — adapters without a `KotaAgentMessage` stream
  reject `onMessage` at the boundary.
- `toolControl: "kota" | "native"` — `"kota"` adapters receive neutral tool
  controls. Native adapters own their CLI loop, so routing omits named-tool
  lists and callbacks. The shared runtime requires each adapter to name one
  machine-authority owner and projects scope into that boundary. Provider
  egress belongs to the trusted CLI process; stricter live revisions abort it.
- `supportsMultiTurn` — single-shot runners set `false`, so the REPL rejects
  them instead of silently downgrading.
- `readiness` — adapter-owned local runtime/auth, optional peer, unsupported-
  option, and exact model/effort preflight. Launch rejects required failures;
  definition validation stays host-independent and probes stay host-local. An
  `unattended` preclaim fails when current access cannot prove renewal.
- `resolveIsolatedHostAuthEnv` — optional non-secret login-locator projection
  when trusted host runners replace `HOME`; tokens remain outside this contract.
- `unsupportedRunOptions` is enforced before hooks or launch and mirrored in
  readiness. Native CLIs without KOTA's tool gate declare `canUseTool`,
  `allowedTools`, and `disallowedTools`; they still honor scope write policy
  through `projectNativeCliScope` and the shared native sandbox.
- `routeKotaToolControlOptions` preserves effective scope policy for fail-closed
  native preflight. Hosted loops refresh policy per call; launched native loops
  abort on stricter revisions.
- `capability-snapshot.ts` derives capability/readiness artifacts from
  declarations, never harness-name catalogs.

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

`hooks.ts` owns neutral lifecycle hooks. Modules register `preRun`/`postRun`
through `ctx.registerHarnessHook`; `runAgentHarness` dispatches declared hook
kinds around the adapter and rejects undeclared kinds.

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

Provider SDK knobs stay off `AgentHarnessRunOptions`. The neutral surface
carries KOTA concepts, ModelClient selection, and portable transport fields.
Adapter-private options travel through validated `harnessOverrides` as opaque
`AgentHarnessStepOverrides`.
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
