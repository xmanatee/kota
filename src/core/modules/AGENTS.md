# Modules Runtime

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

Contribution factories return declarations. Lifecycle registration belongs in
`onLoad`, through `ModuleRuntimeContext`; factories receive the narrower
`ModuleContext` because they may run after provider activation.

Typed module-operation health is scope-bound. Callers supply the authoritative
operation scope from the request, signal, session, or channel runtime; module
loader `cwd` is storage context and must not be used as runtime attribution.
Operations without authoritative scope remain ordinary diagnostics.

Module-log record references bind the stored content identity because retention reuses
line numbers. Unqualified log references provide bounded current context.

Module logs resolve through the host runtime-scope provider. Tool/session/workflow scope
owns request logs; explicit operation scope takes precedence. Activation logs
use the loader's declared canonical `scopeRoot`, never its storage `cwd` or the
registry default. Scope-less activation diagnostics stay on the terminal stream.
Standalone hosts supply their canonical root explicitly. A withdrawn runtime
cannot fall back to disk or another host's provider.
Provider registration history belongs to the host registry and survives withdrawal,
including when registration and withdrawal occur between module log calls.

`ModuleLoader` owns its `ProviderRegistry`. Runtime composition roots pass the
host registry explicitly when it must also be the single CLI process registry;
embedded and test hosts use a fresh registry. Never initialize, replace, or
reset the process registry from a module or a nested host. Register through the
module context so unload can remove only that module's contributions.

When activation allocates resources, `onLoad` returns a `ModuleActivation`
whose `dispose` releases that exact instance. Each loader tracks exact registration disposers in one owned list. Withdrawal
precedes asynchronous activation disposal, including single-module unload. Each
load attempt has its own registration authority, revoked before withdrawal and
on failed admission. Retained contexts cannot contribute to a later activation
with the same name; disposal may still unsubscribe and emit cleanup events.
Process-wide executable names remain unique; rejected loaders cannot withdraw
another activation by its module label. Lifecycle mutations are serialized; shutdown disposes in reverse load order. Do not add a reset-all teardown path; process-owned exceptions must stay
at the CLI composition boundary and must not promise multi-host isolation.

The interactive CLI is the only process-level composition root. Daemon, web,
MCP, workflow, and server hosts own their buses, schedulers, registries,
loaders, routes, manifests, and activations. Extend host ownership; do not add
process singletons or let nested hosts clean up CLI state.

- Treat `<scope>/.kota/modules/` as untrusted. Resolve persisted machine trust
  before discovery or re-import; caller `KotaConfig` is not authority.
- Foreign modules are a transport variant of the same module model, not a
  separate extension system. A connected transport remains a pending candidate
  until loader admission transfers it into normal activation ownership;
  rejected candidates are discarded before the next admission.
- `ModuleStorage` is an atomic UTF-8 text/JSON container, not a schema authority.
  `getJSON` returns `unknown`; each owning module decodes, versions, and
  migrates its durable value. A malformed file is distinct from an absent key
  and must not be silently replaced with defaults.
- Module text persistence selects identities through `module-files.ts` and performs
  I/O through the shared anchored filesystem owner, including enumeration and
  cleanup. Authorization stays with callers. Installed names retain their exact single
  path component (including dots); manifest authoring owns its narrower name policy.
  Installers validate the same storage identity before effects. Keys retain lossless legacy filenames;
  reject ambiguous keys rather than guessing which value a sanitized name meant.
  Exact stored filenames remain accessible without renaming existing data.
  `getDir()` is informational and grants no filesystem safety to executable imports
  or binary database adapters. The anchored owner's documented directory-relocation
  and optimistic snapshot limits apply here too.
- Module capability/effect inspection goes through the module manifest
  projection in `module-manifest.ts`; derive contribution lists from loader
  state and add module-owned capability/data/effect declarations there instead
  of creating a second catalog.
- CLI-only provider loading should activate the configured provider modules and
  their declared dependencies without loading unrelated module side effects.
- Provider registration and lookup use typed `ProviderToken<T>` values.
  Cross-cutting tokens live in `provider-registry.ts`; domain tokens live with
  their owning type.
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
  Keep path grammar and params in the matcher and registration validation in
  the loader/host. Hosts own authorization; the server-layer invocation boundary
  contains failures from normal handlers and protocol-shaped auth denials.

Module sessions preserve by default. Supply `continuityKey` to recover the same
work; context namespaces it by module and child factories bind parent ownership.
Omission creates independently preserved work. Labels do not identify work.

## Lifecycle Modes

`ModuleLoader` declares `{ mode: "commands" | "runtime" }` at construction:

- `"commands"`: populate commands, local clients, and static contributions
  without `onLoad`, tools, foreign modules, or providers. Runtime-dependent
  route and health accessors throw.
- `"runtime"`: drive the full lifecycle for long-lived hosts. Use
  `loadRuntimeModules`, bind the host `EventBus`, clean owned listeners on every
  exit path, and let sessions borrow host state.

Every loader host owns a complete lifecycle. Metadata-only commands loaders
must unload after taking their snapshot, including failure paths; callers do
not retain a loader merely to keep declarative contributions registered.

Tests declare their loader mode, bind runtime hosts explicitly, and supply an
event authority. Commands-mode access remains limited to static contributions.
