---
id: task-invert-corerendering-module-imports-via-neutral-ch
title: Invert core→rendering-module imports via neutral chrome and CLI-transport providers
status: ready
priority: p2
area: architecture
summary: Move CliTransport out of src/core/loop/transport.ts and chrome rendering out of src/core/repl/harness-repl.ts via a rendering provider seam, and add a no-rendering-imports-in-core guard mirroring voice/history/execution.
created_at: 2026-04-24T09:50:20.040Z
updated_at: 2026-04-24T09:50:20.040Z
---

## Problem

Two non-test files under `src/core/` still reach directly into the
rendering module:

- `src/core/loop/transport.ts` imports `#modules/rendering/primitives.js`
  and `#modules/rendering/transport.js` to implement `CliTransport`, which
  `loop-constructor.ts` instantiates as the default agent transport.
- `src/core/repl/harness-repl.ts` imports the same module for `blank`,
  `line`, `plain`, `span`, and `TerminalTransport` to paint REPL chrome
  (banner, status, /help, goodbye, errors).

This violates the same boundary that was just closed for voice
(`aa59e6f8`), execution (`b91e15d4`), and history (`8f12be9e`). Unlike
those cases, rendering has no import-guard test, so the boundary silently
regresses whenever a new core path wants themed output. Core and
minimal-deployment builds that do not load the rendering module cannot
run today's REPL or default agent transport because the imports are
resolved at load time.

## Desired Outcome

Rendering is a module-owned capability. Core defines a small neutral
protocol for "paint an agent event to a terminal" and "paint REPL
chrome", the rendering module registers the default implementation via
its `onLoad`, and `loop-constructor.ts` / `harness-repl.ts` resolve the
implementation through the provider registry rather than importing
`#modules/rendering/*` directly. Operators running KOTA without the
rendering module degrade to a neutral fallback (no-color plain text or
`NullTransport`) instead of a load-time import failure. A focused import
guard fails the build if any core file re-adds a `#modules/rendering/*`
import.

## Constraints

- Do not move `Transport`, `AgentEvent`, `NullTransport`, `ProxyTransport`,
  or `BufferTransport` out of core. They are the neutral event contract
  that every non-CLI transport (session pool, daemon control, server
  routes, delegate, tool runner) already depends on.
- Keep `CliTransport` behavior unchanged from the operator's perspective.
  Verbose/quiet flags, NO_COLOR detection, theme fallback, cost display,
  guardrail messages, and tool-metric formatting must match the current
  `src/transport.test.ts` assertions.
- Follow the same seam shape used for voice/history/execution: a provider
  type in `src/core/modules/provider-types.ts`, registration via
  `ctx.registerProvider(...)` inside the rendering module's `onLoad`,
  resolution via a `getRenderingProvider()` (or equivalent) in
  `src/core/modules/provider-registry.ts`, and an import-guard test at
  `src/core/modules/no-rendering-imports-in-core.test.ts`.
- Do not add a second rendering primitive vocabulary in core. If the
  primitives themselves need to be reachable from core, move them into
  `provider-types.ts` (pure data, no runtime deps) rather than duplicating
  them.
- No parallel "minimal transport" path or compatibility shim. When the
  rendering module is not loaded, `loop-constructor.ts` must pick a
  neutral fallback (e.g. `NullTransport`) or the caller must pass an
  explicit transport; the REPL must either refuse to start or use a plain
  writer with no ANSI.
- Preserve every non-test import of `#core/loop/transport.js`. Callers
  outside core (telegram channel, daemon handle, daemon control chat,
  session pool, delegate, tool runner, server routes) should continue to
  import `Transport` / `AgentEvent` / `NullTransport` / `ProxyTransport`
  / `BufferTransport` without knowing about the rendering module.

## Done When

- `grep -rn "#modules/rendering" src/core/` returns no hits outside
  dedicated test files.
- `src/core/modules/no-rendering-imports-in-core.test.ts` exists and
  fails the build if any non-test core file imports `#modules/rendering/`.
- The rendering module registers the default CLI transport and REPL
  chrome through `ctx.registerProvider(...)` in its `onLoad`, mirroring
  the voice/history/execution registrations.
- `loop-constructor.ts` resolves its default transport via the provider
  registry (or degrades to `NullTransport` when the rendering module is
  not loaded). `core/repl/harness-repl.ts` resolves chrome the same way.
- `CliTransport`'s behavior under every case in `src/transport.test.ts`
  still holds after the file moves into `src/modules/rendering/`.
- Existing consumers of `#core/loop/transport.js` (`Transport`,
  `AgentEvent`, `NullTransport`, `ProxyTransport`, `BufferTransport`) keep
  working without changes to their imports.
- `pnpm typecheck`, `pnpm test`, `pnpm lint`, and workflow dispatch still
  pass locally with and without the rendering module present.
