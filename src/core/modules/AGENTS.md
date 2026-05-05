# Modules Runtime

This directory owns module discovery, loading, lifecycle, provider registration,
and foreign-module transports.

## Module Loader Layout

`module-loader.ts` is the orchestrator: it owns the `ModuleLoader` class, the
public accessor surface, and lifecycle-mode wiring. Each load-time concern
with cohesive state lives in a sibling file. New concerns land as a phase
function in the appropriate sibling, not as a fresh inline block in
`module-loader.ts`.

- `module-loader-state.ts` — the shared `LoaderState` shape every phase reads
  or mutates.
- `module-loader-context.ts` — `createLoaderModuleContext` and per-loader
  tool-call-depth bookkeeping.
- `module-loader-load-phases.ts` — every load phase as a typed function
  (duplicate-name guard, dependency precondition, config/event/tool/workflow/
  channel/command/route registration, `onLoad`, skills, agents). The
  `runModuleLoadPhases` helper drives the sequence so the orchestrator only
  owns early checks and final dispatch.
- `module-loader-clients.ts` — local- and daemon-side `KotaClient` handler
  collection plus the runtime `assembleDaemonClientHandlers(transport)`
  builder.
- `module-loader-bootstrap.ts` — multi-module orchestrators outside a single
  `load()`: `loadAllModules`, `reloadModule`, `reimportModule`, provider
  activation.
- `module-loader-summaries.ts` — read-only `getModuleSummaries` and
  `formatSkillsPrompt` derivations.
- `module-lifecycle.ts` — the unload-side counterpart and paired state
  cleanup.

## Module Context Surfaces

The runtime hands every module hook the same physical context object, but the
typed protocol exposes fewer capabilities to non-`onLoad` hooks. Two surfaces
matter:

- `ModuleContext` — the **contribution context**. Available to `tools`,
  `commands`, `routes`, `controlRoutes`, `localClient`, plus the `workflows`,
  `channels`, `skills`, and `agents` factories (and any handler closure built
  from them). Read access, tool invocation, provider lookup, event emit,
  per-call session creation, and CLI-local `KotaClient` access. No lifecycle
  registration.
- `ModuleRuntimeContext` — the **runtime context**, used only for `onLoad`.
  Extends `ModuleContext` with the registration capabilities that mutate
  load-time runtime state: `registerProvider`, `registerMiddleware`,
  `registerGroup`, and the loop/harness decoration hooks
  (`registerCleanupHook`, `registerDynamicStateProvider`, `registerPreSendHook`,
  `registerHarnessHook`).

Lifecycle registration belongs in `onLoad`. A factory hook that reaches for
`registerProvider` is doing something the protocol forbids — providers may
already be activated by the time a route handler runs, and a contribution
factory's idempotency story is much weaker than the lifecycle's. The capability
boundary is enforced at compile time by `module-context-capabilities.test.ts`.

- Keep modules as the single contribution boundary for tools, workflows,
  channels, providers, agents, and related runtime services.
- Foreign modules are a transport variant of the same module model, not a
  separate extension system.
- Keep protocol details strict and code-owned. Message names, config fields,
  transport variants, health states, and generated scaffold details belong in
  types, schemas, examples, and focused tests instead of docs catalogs.
- CLI-only provider loading should activate the configured provider modules and
  their declared dependencies without loading unrelated module side effects.
- Provider registration and lookup go through typed `ProviderToken<T>` values.
  Cross-cutting tokens (memory/knowledge/history/task/repo-tasks/rendering/
  model-pricing) are exported from `provider-registry.ts`; module-domain
  tokens (recall/capture/retract/answer/transcription/speech-synthesis,
  workflow dispatcher, metrics source, etc.) live with their owning type.
  The repo guard at `provider-registration-guard.test.ts` rejects new raw
  string registrations on the registry surface.
- `mod.routes`, `mod.commands`, and `mod.controlRoutes` are pure-data
  contributions: the loader invokes each factory once at module load and
  caches the result. `getRoutes()`, `getCommands()`, `getContributedControlRoutes()`,
  and `getModuleSummaries()` read those cached snapshots and never re-invoke
  the factories. Module authors must not emit logs, register subscribers, or
  perform other side effects from those factories — runtime warnings about
  missing config belong in `onLoad` (one-shot at runtime-mode boot) or in a
  module `healthCheck` (surfaced through `kota doctor`).
- `RouteRegistration` (public `kota serve` surface) and
  `ControlRouteRegistration` (daemon-control surface) share one descriptor
  protocol (`ModuleRouteBase` in `module-types.ts`). Both surfaces use the
  same `:name` and trailing `*name` path grammar, the same handler signature
  `(req, res, params)`, and the same `bypassAuth` posture. Path matching is
  owned by `route-matcher.ts` so both servers extract params and resolve
  collisions identically. `ControlRouteRegistration` extends the base with
  `capabilityScope: "read" | "control"`; the daemon-control server applies
  the same capability gate to module-contributed control routes as to
  built-in ones.

## Lifecycle Modes

`ModuleLoader` runs in one of two typed lifecycle modes, set at construction
through `{ mode: "commands" | "runtime" }`. The mode is the protocol boundary
between cheap CLI subcommand registration and a fully-driven module runtime.

- `"commands"`: register CLI command shape and local-side `KotaClient`
  handlers, and populate every statically-resolved module contribution
  (workflows, channels, agents, skills, route registrations). Skips
  `onLoad`, tool registration, foreign modules, and provider activation, so
  CLI startup stays cheap. Callers may safely consume the static
  contributions plus `getCommands()`, `getModuleSummaries()`,
  `getLocalClientHandlers()`, `getLoadedModules()`, `getModuleStorage()`,
  and `getRegisteredConfigKeys()`. The accessors that depend on those
  skipped side effects — `getRoutes`, `getContributedControlRoutes`, and
  `probeHealthChecks` — throw, because route handlers and module health
  probes close over provider/runtime state that `onLoad` never initialized.
- `"runtime"`: drive every module's lifecycle to completion. Required by any
  long-lived host that serves provider-backed routes or runs workflows. Use
  `loadRuntimeModules` for all daemon, MCP, eval-harness, and similar paths.
  All accessors are safe in this mode.

The runtime-only guard prevents a partial-context bug class: a daemon that
reads route contributions from a `"commands"` snapshot whose `onLoad` hooks
were skipped will advertise routes whose providers are uninitialized. The
typed boundary fails at the accessor instead of at request time. Static
contributions stay safe in commands mode because they are populated from
module definitions during `load()` regardless of mode — which is what
`kota workflow validate`, `kota workflow exec`, and the daemon's
`reloadConfig` diff rely on.

Tests, helpers, and runtime hosts must declare which mode they exercise:
commands-mode callers may read static contributions but not `getRoutes()`,
`getContributedControlRoutes()`, or `probeHealthChecks()`; runtime-mode
callers may read every accessor.
