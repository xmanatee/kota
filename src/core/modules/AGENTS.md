# Modules Runtime

This directory owns module discovery, loading, lifecycle, provider registration,
and foreign-module transports.

## Module Loader Layout

`module-loader.ts` owns the `ModuleLoader` orchestrator, public accessors, and
lifecycle-mode wiring. Cohesive load concerns belong in sibling phase files.

- `module-loader-state.ts` — shared `LoaderState` for every phase.
- `module-loader-context.ts` — `createLoaderModuleContext` and per-loader
  tool-call-depth bookkeeping.
- `module-loader-load-phases.ts` — every load phase as a typed function
  (duplicate-name guard, dependency precondition, config/event/tool/workflow/
  channel/command/route registration, `onLoad`, skills, agents). The
  `runModuleLoadPhases` helper drives the sequence so the orchestrator only
  owns early checks and final dispatch.
- `module-loader-clients.ts` — local/daemon `KotaClient` handler assembly.
- `module-loader-bootstrap.ts` — multi-module orchestrators outside a single
  `load()`: `loadAllModules`, `reloadModule`, `reimportModule`, provider
  activation.
- `module-loader-skills.ts` / `module-loader-summaries.ts` — imported-skill
  refresh, summaries, and prompt derivation.
- `module-lifecycle.ts` — the unload-side counterpart and paired state
  cleanup.

## Module Context Surfaces

Every hook receives the same context object, but the typed protocol exposes
fewer capabilities outside `onLoad`:

- `ModuleContext` — the **contribution context** for `tools`,
  `commands`, `routes`, `controlRoutes`, `localClient`, plus the `workflows`,
  `channels`, `skills`, and `agents` factories (and any handler closure built
  from them). Read access, tool invocation, provider lookup, event emit,
  per-call sessions, and CLI-local `KotaClient` access. No lifecycle registration.
- `ModuleRuntimeContext` — the **runtime context** for `onLoad`. It adds
  load-time registration: `registerProvider`, `registerMiddleware`,
  `registerGroup`, and the loop/harness decoration hooks
  (`registerCleanupHook`, `registerDynamicStateProvider`, `registerPreSendHook`,
  `registerHarnessHook`).

Lifecycle registration belongs in `onLoad`; contribution factories may run
after provider activation. `module-context-capabilities.test.ts` enforces this.

- Modules own tool, workflow, channel, provider, agent, and service contributions.
- Treat `<project>/.kota/modules/` as untrusted. Resolve persisted machine trust
  before discovery or re-import; caller `KotaConfig` is not authority.
- Foreign modules are a transport variant of the same module model, not a
  separate extension system.
- Keep protocol details strict and code-owned. Message names, config fields,
  transport variants, health states, and generated scaffold details belong in
  types, schemas, examples, and focused tests instead of docs catalogs.
- Module capability/effect inspection goes through the module manifest
  projection in `module-manifest.ts`; derive contribution lists from loader
  state and add module-owned capability/data/effect declarations there instead
  of creating a second catalog.
- CLI-only provider loading should activate the configured provider modules and
  their declared dependencies without loading unrelated module side effects.
- Provider registration and lookup use typed `ProviderToken<T>` values.
  Cross-cutting tokens live in `provider-registry.ts`; domain tokens live with
  their owning type. `provider-registration-guard.test.ts` rejects raw string
  registrations.
- `mod.routes`, `mod.commands`, and `mod.controlRoutes` are pure-data
  contributions: the loader invokes each factory once at module load and
  caches the result. `getRoutes()`, `getCommands()`, `getContributedControlRoutes()`,
  and `getModuleSummaries()` read those cached snapshots and never re-invoke
  the factories. Module authors must not emit logs, register subscribers, or
  perform other side effects from those factories — runtime warnings about
  missing config belong in `onLoad` or a module `healthCheck` surfaced through `kota doctor`.
- `mod.uiSurfaces` contributes side-effect-free live source definitions; the loader caches them,
  while `assembleUiSurfaceBundle` projects, validates, and orders one scoped graph.
  Capability reads belong in the projector, never in the contribution factory or `onLoad`.
- `RouteRegistration` (public `kota serve` surface) and `ControlRouteRegistration`
  (daemon-control surface) share `ModuleRouteBase` from `module-types.ts`. Both surfaces use the
  same `:name` and trailing `*name` path grammar, the same handler signature
  `(req, res, params)`, the same `bypassAuth` posture, and the same optional
  auth-failure handler for protocol-shaped denials. Path matching is owned by
  `route-matcher.ts` so both servers extract params and resolve collisions
  identically. `ControlRouteRegistration` extends the base with
  `capabilityScope: "read" | "control"`; the daemon-control server applies the
  same capability gate to module-contributed control routes as to built-in
  ones.

## Lifecycle Modes

`ModuleLoader` runs in one of two typed lifecycle modes, set at construction
through `{ mode: "commands" | "runtime" }`. The mode is the protocol boundary
between cheap CLI subcommand registration and a fully-driven module runtime.

- `"commands"`: register CLI command shape and local-side `KotaClient`
  handlers, and populate every statically-resolved module contribution
  (workflows, channels, UI source definitions, agents, skills, route registrations). Skips
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
  Bind the host `EventBus` before lifecycle execution. `loadRuntimeModules`
  rejects a missing bus; direct runtime loaders must call `setBus` explicitly.
  Without a bound authority, loading and event calls fail. Failed load, unload, reload,
  and shutdown remove owned listeners. Sessions borrow host runtime state.

The runtime-only guard prevents a partial-context bug class: a daemon that
reads route contributions from a `"commands"` snapshot whose `onLoad` hooks
were skipped will advertise routes whose providers are uninitialized. The
typed boundary fails at the accessor instead of at request time. Static
contributions stay safe in commands mode because they are populated from
module definitions during `load()` regardless of mode — which is what
`kota workflow validate` and the daemon's `reloadConfig` diff rely on.
`kota workflow exec` registers its command shape in commands mode, then
hydrates a runtime-mode loader inside the action before executing the run so
workflow tool steps and module lifecycle state are available.

Tests and hosts declare their mode and bind runtime test loaders explicitly:
commands-mode callers may read static contributions but not `getRoutes()`,
`getContributedControlRoutes()`, or `probeHealthChecks()`; runtime-mode
callers may read every accessor; event tests supply an authority.
