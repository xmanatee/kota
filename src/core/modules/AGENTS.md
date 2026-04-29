# Modules Runtime

This directory owns module discovery, loading, lifecycle, provider registration,
and foreign-module transports.

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

The runtime-only guard exists because the 2026-04-28 daemon regression read
route contributions from a `"commands"` snapshot whose `onLoad` hooks had
been intentionally skipped. The shipped binary advertised `/api/knowledge`,
`/api/memory`, `/api/history`, `/recall`, and `/answer` — all returning 500
with "provider not initialized" — while `/status` looked healthy. The typed
boundary now fails at the accessor instead of at request time, so the same
partial context cannot silently ship again. Static-contribution accessors
stay safe in commands mode because they are populated from module
definitions during `load()` regardless of mode, which is what the CLI
relies on for `kota workflow validate`, `kota workflow exec`, the daemon's
own `reloadConfig` diff, and similar inspection paths.

Tests, helpers, and runtime hosts must declare which mode they exercise:

- A test that wants commands-only fixtures uses `mode: "commands"`. It may
  read static contributions, but consuming `getRoutes()`,
  `getContributedControlRoutes()`, or `probeHealthChecks()` is the
  partial-context bug class and the loader will throw.
- A test that wants runtime fixtures uses `mode: "runtime"` (or
  `loadRuntimeModules`) and may read every accessor.

The regression fixture lives at the loader test layer
(`module-loader.test.ts`) and at the daemon integration layer
(`daemon-runtime-load.integration.test.ts`). Together they prove that a
`"commands"` loader cannot hand back a runtime-dependent contribution
(routes/control-routes/health-checks) under any path, that the same loader
still exposes static contributions cleanly, and that a runtime-mode
loader's contributions wire up correctly inside a real `Daemon`.
