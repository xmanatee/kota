# Modules Runtime

This directory owns module discovery, loading, lifecycle, provider registration,
and foreign-module transports.

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

`ModuleLoader` owns its `ProviderRegistry`. Runtime composition roots pass the
host registry explicitly when it must also be the single CLI process registry;
embedded and test hosts use a fresh registry. Never initialize, replace, or
reset the process registry from a module or a nested host. Register through the
module context so unload can remove only that module's contributions.

When activation allocates resources, `onLoad` returns a `ModuleActivation`
whose `dispose` releases that exact instance. Loader shutdown withdraws owned
contributions synchronously and disposes activated instances in reverse load
order. Do not add a reset-all teardown path; process-owned exceptions must stay
at the CLI composition boundary and must not promise multi-host isolation.

The legacy core-tool catalog is the remaining explicit interactive-CLI process
owner. Daemon, web, MCP, workflow, and server hosts own their buses, schedulers,
registries, loaders, routes, manifests, and activations. Extend host ownership;
do not add process singletons or let nested hosts clean up CLI state.

- Modules own tool, workflow, channel, provider, agent, and service contributions.
- Treat `<scope>/.kota/modules/` as untrusted. Resolve persisted machine trust
  before discovery or re-import; caller `KotaConfig` is not authority.
- Foreign modules are a transport variant of the same module model, not a
  separate extension system.
- Keep protocol details strict and code-owned. Message names, config fields,
  transport variants, health states, and generated scaffold details belong in
  types, schemas, examples, and focused tests instead of docs catalogs.
- `ModuleStorage` is an atomic byte/JSON container, not a schema authority.
  `getJSON` returns `unknown`; each owning module decodes, versions, and
  migrates its durable value. A malformed file is distinct from an absent key
  and must not be silently replaced with defaults.
- Module capability/effect inspection goes through the module manifest
  projection in `module-manifest.ts`; derive contribution lists from loader
  state and add module-owned capability/data/effect declarations there instead
  of creating a second catalog.
- CLI-only provider loading should activate the configured provider modules and
  their declared dependencies without loading unrelated module side effects.
- Provider registration and lookup use typed `ProviderToken<T>` values.
  Cross-cutting tokens live in `provider-registry.ts`; domain tokens live with
  their owning type. TypeScript rejects raw string registrations at the
  registry boundary.
- Keep provider base protocols minimal. Optional behavior is exposed through a
  typed capability property only by implementations that actually provide it;
  do not add support booleans, required throwing methods, or successful no-op
  mutations. Tests exercise the behavior of declared capabilities and rely on
  TypeScript for structural base-protocol conformance.
- Route, command, and control-route factories are side-effect-free data
  contributions cached once at load. Runtime warnings and subscriptions belong
  in `onLoad` or health checks.
- `mod.uiSurfaces` contributes side-effect-free live source definitions; the loader caches them,
  while `assembleUiSurfaceBundle` scopes, validates, and orders one scoped graph.
  Capability reads belong in the projector, never in the contribution factory or `onLoad`.
- Public and daemon-control routes share `ModuleRouteBase` and
  `route-matcher.ts`; control routes add `capabilityScope: "read" | "control"`.
  Keep path grammar, params, auth failure, collision, and capability behavior
  in those shared owners.

## Lifecycle Modes

`ModuleLoader` runs in one of two typed lifecycle modes, set at construction
through `{ mode: "commands" | "runtime" }`. The mode is the protocol boundary
between cheap CLI subcommand registration and a fully-driven module runtime.

- `"commands"`: populate commands, local clients, and static contributions
  without `onLoad`, tools, foreign modules, or providers. Runtime-dependent
  route and health accessors throw.
- `"runtime"`: drive the full lifecycle for long-lived hosts. Use
  `loadRuntimeModules`, bind the host `EventBus`, clean owned listeners on every
  exit path, and let sessions borrow host state.

The mode boundary prevents commands snapshots from advertising routes whose
providers were never activated. Validation and reload may read static
contributions; execution hydrates a runtime loader first.

Tests and hosts declare their mode and bind runtime test loaders explicitly:
commands-mode callers may read static contributions but not `getRoutes()`,
`getContributedControlRoutes()`, or `probeHealthChecks()`; runtime-mode
callers may read every accessor; event tests supply an authority.
