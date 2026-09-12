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

@module-context.md

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
