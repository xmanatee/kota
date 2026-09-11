# Agent Harness Protocol

This is the harness-neutral boundary used by sessions, steps, and delegates
instead of a specific agent runtime. Adapters live in modules; core owns only
the protocol and registry.

## Protocol

- A harness must not silently coerce unsupported options. If an adapter cannot
  honor a requested option (for example a tools list against a text-only
  harness), it should fail loudly at the boundary.
- `AgentHarnessRunOptions.systemPrompt` is a plain string of portable KOTA
  system-prompt content composed by `buildKotaSystemPrompt` in
  `src/core/loop/`. Harness-neutral callers never build provider-native wire
  shapes; adapters that want to wrap the text in a native envelope do the
  wrapping inside the adapter. `AgentSystemPrompt = string` is the contract
  every adapter consumes.
- Neutral options carry tool risk, live scope policy, commit/daemon guards, and
  injection defense (`scopePolicy`, `getScopePolicySnapshot`, `canUseTool`, MCP
  and tool lists). KOTA-routable loops must honor them; other adapters declare
  them in `unsupportedRunOptions`, so `runAgentHarness` rejects them before
  hooks or launch.
- Harnesses enforce `AgentDef.writeScope` before scope mutation; Git checks
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
  environments, isolated home/temp, scope package-manager runtimes,
  declared auth/read roots, and provider-only egress through a host-owned proxy.
  Native tools lack direct host, loopback, metadata-service, or internet routes.
  KOTA native sandboxes protect `.kota`; only validated `KOTA_RUN_DIR` /
  `KOTA_RUN_TEMP_DIR` evidence and temp paths are writable. Native writer task
  authorization crosses a per-invocation, runtime-owned request/reply boundary:
  only its request directory is additionally writable; responses are read-only.
  Raw daemon databases and SQLite journals never cross the agent read boundary.
  Linux read denials cover every mounted surface, including writable roots and
  runtime write boundaries that have no explicit read grant.
- Dependency discovery grants only physical `node_modules` locations along the
  canonical workspace ancestry. Scope-controlled links cannot authorize their
  targets; external package stores require explicit runtime read grants.
- Native CLI adapters compose their workflow Git and daemon instructions from
  the shared native workflow rails. Keep Git metadata read-only for agents and
  leave staging, rebase continuation, commits, and publication runtime-owned.
- Runtime Probes and production proofs use the fail-closed contained-workspace sandbox; never add an unsandboxed launcher.

## Capability admission

Adapters declare supported owner questions, message streams, multi-turn loops,
tool control, lifecycle hooks and unsupported run options. `runAgentHarness`
rejects incompatible requests before hooks or launch. Capability snapshots derive
from declarations, never harness-name catalogs. Readiness probes stay host-local;
definition validation stays host-independent. An unattended preclaim requires
proof of renewable access.

Native adapters name one machine-authority owner. Runtime protects authority
paths, including aliases, before sandbox selection; overlapping grants cannot
widen them. Hosted loops refresh scope policy per call; native loops abort on
stricter revisions. Login-locator projections never carry tokens.

`modelRouting` opts adapters into provider-owned matrix admission. Native routes
receive native model ids; ModelClient routes retain provider qualification.
The provider owner resolves declarations and invokes model validation before
launch. Missing declarations cannot establish compatibility.

## Registry and selection

- `registerAgentHarness(harness)` registers an adapter under its declared
  `name` and returns an exact-registration disposer. Modules declare adapters
  through `KotaModule.agentHarnesses`; the module host registers during load
  and disposes during unload. Importing a module never registers an adapter.
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
`neutral-protocol-shape.test.ts` checks the public type boundary; provider
adapters own translation of their private field names.

Core interfaces use KOTA-owned neutral types from `message-protocol.ts`;
adapters translate provider types at their seam. Biome enforces the boundary.
`message-codec.ts` is the runtime decoder for neutral messages that cross a
durable or foreign boundary; trusted loop code consumes the decoded type.
Tool input and output schemas use an open JSON Schema object contract. Runtime
admission validates that envelope and JSON compatibility without owning a
closed keyword vocabulary.

## Per-step harness-specific options

Neutral workflow step shapes carry no harness-specific fields. Per-step
overrides route through the `harnessOptions` passthrough — a single-key
record whose key equals the step's resolved harness name and whose value
is validated by that harness's `validateStepOptions` method. The
validated fragment travels to the adapter via
`AgentHarnessRunOptions.harnessOverrides`. Leaving `harnessOptions`
unset uses each adapter's defaults. New harness-only knobs belong on
`validateStepOptions`, not on the neutral step.
