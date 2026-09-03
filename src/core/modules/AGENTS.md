# Modules Runtime

This directory owns module discovery, loading, lifecycle, provider registration,
and foreign-module transports.

Runtime-loaded declarations are decoded by `assertModuleDefinition` before
dependency sorting or lifecycle work. Keep top-level declaration shape there;
capability-specific validators own the contents of declared contributions.
Event schemas are decoded by the event contract, and module client factory
results are decoded from generated namespace and method descriptors before the
host consumes them; do not duplicate either shape in the loader.
Daemon transport operations are authored in the canonical contract graph and
projected into generated clients; modules contribute handlers, not a parallel
operation-descriptor declaration.
Agent harness adapters are declarative `agentHarnesses` contributions; the
loader owns their registration and exact withdrawal with module lifecycle.
Agent and skill identities have one module owner across a loader host;
collisions fail admission before either identity can be published.
Config slices have one structural module owner. Composition roots register only
declarations accepted by the shared identity admission before loading config,
while each loader acquires and releases its own exact lease so rejection or
shutdown cannot withdraw another host's registration.
Health hook return values remain boundary data until the host decodes them;
malformed checks become unhealthy and malformed lifecycle projections are not
published in module summaries.

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

Typed module-operation health is scope-bound. Callers supply the authoritative
operation scope from the request, signal, session, or channel runtime; module
loader `cwd` is storage context and must not be used as runtime attribution.
Operations without authoritative scope remain ordinary diagnostics.

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

The interactive CLI is the only process-level composition root. Daemon, web,
MCP, workflow, and server hosts own their buses, schedulers, registries,
loaders, routes, manifests, and activations. Extend host ownership; do not add
process singletons or let nested hosts clean up CLI state.

- Modules own tool, workflow, channel, provider, agent, and service contributions.
- Treat `<scope>/.kota/modules/` as untrusted. Resolve persisted machine trust
  before discovery or re-import; caller `KotaConfig` is not authority.
- Foreign modules are a transport variant of the same module model, not a
  separate extension system. A connected transport remains a pending candidate
  until loader admission transfers it into normal activation ownership;
  rejected candidates are discarded before the next admission.
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
  contributions decoded and cached once at load; malformed results fail
  admission. Runtime warnings and subscriptions belong in `onLoad` or health
  checks.
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

Every loader host owns a complete lifecycle. Metadata-only commands loaders
must unload after taking their snapshot, including failure paths; callers do
not retain a loader merely to keep declarative contributions registered.

Tests and hosts declare their mode and bind runtime test loaders explicitly:
commands-mode callers may read static contributions but not `getRoutes()`,
`getContributedControlRoutes()`, or `probeHealthChecks()`; runtime-mode
callers may read every accessor; event tests supply an authority.
