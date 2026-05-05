---
id: task-split-moduleloader-class-into-per-load-phase-handl
title: Split ModuleLoader class into per-load-phase handler files
status: ready
priority: p1
area: core
summary: Split ModuleLoader (core/modules/module-loader.ts) into per-load-phase sibling files so module-loader.ts drops well under the 300-line guideline
created_at: 2026-05-05T10:04:07.957Z
updated_at: 2026-05-05T10:04:07.957Z
---

## Problem

`src/core/modules/module-loader.ts` is 814 lines — now the largest non-test
file in the entire repo, well past the 300-line guideline. The bulk is one
`ModuleLoader` class that owns every load-time concern in a single body:
duplicate-name + dependency guards, config-slice registration, module-event
registration, tool registration (with commands-mode skip), workflow and
channel contribution wiring (with project/installed source resolution),
local-side and daemon-side `KotaClient` handler collection and assembly,
command/route/control-route contribution with per-module error capture,
`onLoad` invocation, skill file-read + content cache, agent contribution,
context construction with tool-call-depth tracking, and the runtime-mode
guard for the three runtime-only accessors (`getRoutes`,
`getContributedControlRoutes`, `probeHealthChecks`).

The single `load(mod)` method alone is ~150 lines (lines 318–464) running
nine to twelve distinct load phases inline. Every new module surface — the
recent `daemonClient(link)`-factory namespace migration cluster added two
helper functions (`assignLocalClientHandler`, `assignDaemonClientHandler`)
and three private methods (`collectLocalClientHandlers`,
`collectDaemonClientFactory`, `assembleDaemonClientHandlers`) directly to
this file — accretes another inline phase or pair of fields rather than
landing in a cohesive sibling. A previous split task
(`task-split-module-loader-ts.md`, 2026-03-19) trimmed the file to 300
lines by extracting topo-sort into `module-deps.ts`, but the file has
grown back to 814 because the `ModuleLoader` class itself was never carved
up. Without a per-phase seam the next migration cluster will repeat the
same accretion.

The directory already establishes the right convention: `module-deps.ts`,
`module-discovery.ts`, `module-lifecycle.ts`, `module-context.ts`,
`module-storage.ts`, `module-types.ts`, and the `foreign-module-*.ts`
family all live as siblings, and `module-lifecycle.ts` already owns the
unload-side counterpart of the lifecycle. The `<phase>.ts` sibling seam is
already established here. The class itself is what hasn't been split.

## Desired Outcome

`src/core/modules/module-loader.ts` is a thin orchestrator: lifecycle-mode
wiring (`getMode`, `assertRuntime`, `setSessionFactory`, `setCwd`), the
`ModuleLoader` class shell that owns the per-module state maps, the
top-level `load(mod)` and `loadAll(projectModules, installedModules)`
orchestration that calls each load-phase function in order, the module
unload entry points that delegate to `module-lifecycle.ts`, and the
public accessor surface (`getModuleSummaries`, `getCommands`,
`getLoadedModules`, `getRegisteredConfigKeys`, `getModuleStorage`,
`getLocalClientHandlers`, `assembleDaemonClientHandlers`, plus the
runtime-only `getRoutes`, `getContributedControlRoutes`,
`probeHealthChecks` guarded through `assertRuntime`).

Every cohesive load-time concern lives in its own sibling file. The
intended seam (builder picks the exact file boundaries; this names the
shape, not the partition) is per load-phase, not arbitrary:

- `module-loader-clients.ts` — local-side and daemon-side `KotaClient`
  handler collection and assembly. Owns the per-namespace assignment
  helpers (`assignLocalClientHandler`, `assignDaemonClientHandler`),
  the `collectLocalClientHandlers` / `collectDaemonClientFactory` /
  `assembleDaemonClientHandlers` logic, and the
  `DaemonClientFactoryEntry` type.
- `module-loader-context.ts` — `createContext(moduleName?)`
  construction. Owns the tool-call-depth bookkeeping and the
  `MAX_TOOL_CALL_DEPTH` constant, exposing a thin
  `createLoaderModuleContext(state, moduleName?)` entry point.
- `module-loader-load-phases.ts` — the inline load phases inside
  `load(mod)`: dependency-precondition check, config-slice
  registration, module-event registration, tool registration,
  workflow contribution + project/installed source resolution,
  channel contribution, command / route / control-route contribution
  with per-module error capture, `onLoad` invocation, skill file-read
  + content cache, agent contribution. Each phase is exported as a
  small typed function the orchestrator calls in order. The
  orchestrator does not hold per-phase logic inline.

The orchestrator dispatches by phase to the per-phase functions, passing
whatever cross-cutting state is required (the per-module state maps,
the `ctx`, the lifecycle mode, the cwd, the verbose flag). The class
owns the typed state maps and exposes the public accessors; the phase
files own the load-time computation. `module-loader.ts` is well under
the 300-line guideline (target: ≤ 250 lines).

The split is per load-phase, not arbitrary. Each new file has one reason
to change (one load-phase concern) and one set of dependencies. The
behaviour is unchanged — same module load order, same error messages,
same per-module state, same runtime-only guard, same accessor outputs.

## Constraints

- Keep loader behaviour byte-identical for every observable surface.
  Module load order, the exact error-message text on duplicate name /
  missing dependency / duplicate config-slice / duplicate
  local-client namespace / duplicate daemon-client namespace, the
  runtime-only guard's failure message, the per-module command / route
  / control-route error capture (`console.error` text), and every
  accessor's return shape stay unchanged. Existing
  `module-loader.test.ts`, `module-deps.test.ts`,
  `module-discovery.test.ts`, `module-context.test.ts`,
  `module-context-capabilities.test.ts`, `module-storage.test.ts`, the
  daemon integration test, and the wider `core/modules` test suite
  must pass without edits to assertions about loader behaviour.
- Each phase file owns its own logic. The orchestrator does not hold
  inline body for a phase that has been extracted; delete the inline
  copy cleanly.
- Use plain functions or small classes, whichever the phase naturally
  wants. Do not introduce a parallel `BasePhase` abstraction or a
  second registry — `module-loader.ts` is the one orchestrator, and
  per-phase files expose typed functions it calls. No DSL.
- Do not move `ModuleLoaderMode`, `ModuleLoaderOptions`,
  `RUNTIME_ONLY_GETTERS`, or `RuntimeOnlyGetter` unless they are
  private to one phase. Cross-cutting types stay in `module-loader.ts`
  (or a tiny shared `module-loader-types.ts`); pick one and stick to
  it.
- The public surface re-exports stay where they are
  (`ModuleSource`, `ModuleSummary` from `module-types.ts`); do not
  change consumer import paths.
- Per the `simplest, clearest, most maintainable final system` rule,
  prefer a larger cohesive change over a partial split that leaves a
  half-divided loader. Split every clearly-owned load-phase concern
  in this task, not just the easiest one or two.
- No backwards-compatibility shim, alias re-exports, deprecated method
  stubs, or "moved to X" comments. Delete the old methods cleanly.
- Drop ad-hoc cleanup (e.g. unused imports, redundant `private`
  methods that only forward) that the split exposes. Do not leave
  dead code in the orchestrator.
- The `module-loader.test.ts` regression fixture for the 2026-04-28
  daemon partial-context bug (commands-mode loader rejecting
  `getRoutes` / `getContributedControlRoutes` / `probeHealthChecks`)
  must keep passing without assertion edits. The runtime-only guard
  is a load-bearing invariant, not a candidate for refactor.

## Done When

- `wc -l src/core/modules/module-loader.ts` reports ≤ 250 lines.
- Each new sibling phase file is at or under the 300-line guideline.
  No new file ships at >300.
- `pnpm test` passes against the full repo test suite with no edited
  assertions about loader behaviour, error messages, or accessor
  outputs.
- `pnpm typecheck` and the lint gate pass.
- `src/core/modules/AGENTS.md` is updated to name the per-load-phase
  file convention as the way new module load-time concerns land — one
  file per phase, dispatched from the central `module-loader.ts`.
- A short `wc -l src/core/modules/module-loader*.ts` snapshot before /
  after ships in the run directory so the size collapse is visible.

## Source / Intent

Identified by explorer run `2026-05-05T10-01-51-432Z-explorer-fwaf1z`
after the McpServer split (`task-split-mcpserver-class-into-per-mcp-feature-handler.md`,
done 2026-05-05) collapsed the previous-largest-file anchor (`server.ts`
841 → 197 lines via per-MCP-feature handler files). With that anchor done,
the next-largest non-test file is `src/core/modules/module-loader.ts` at
814 lines — a single class that bundles every load-time concern (config
slices, module events, tool registration, workflow / channel
contribution, local + daemon `KotaClient` handler collection, route
contribution, skill loading, agent contribution, context construction,
runtime-only guard) and grows by one inline phase per new module-surface
migration. Three strategic blocked alternatives all carry operator-only
preconditions (operator-capture, capability-installed) and cannot be
unblocked autonomously; this task is autonomously actionable, beats them
on "available next step" grounds, and continues the recent direction of
shrinking the largest architectural anchors toward the 300-line
guideline. A 2026-03-19 split (`task-split-module-loader-ts.md`)
established the sibling-file convention but only extracted topo-sort;
the loader has accreted back to 814 lines through subsequent module-
surface migrations, so the per-phase seam is needed to keep future
clusters from rebuilding the same monolith.

## Initiative

Module-first / core-shrinking architecture: the load phases are
naturally per-concern, the directory already established
`module-deps.ts` / `module-lifecycle.ts` / `module-discovery.ts` /
`module-context.ts` as the split convention, and this task brings the
central `module-loader.ts` into line with the rest of the directory.
Ongoing module-surface migrations (the recent `daemonClient(link)`
namespace cluster added per-namespace handler collection / assembly to
this file) make the per-phase seam load-bearing, not cosmetic.

## Acceptance Evidence

- `wc -l src/core/modules/module-loader*.ts` snapshot before and after
  the split, captured to the run directory under
  `.kota/runs/<run-id>/module-loader-wc.txt`, showing
  `module-loader.ts` ≤ 250 lines and every new sibling file ≤ 300.
- Existing `src/core/modules/module-loader.test.ts` plus the broader
  `core/modules` test suite passes with no assertion edits about
  loader behaviour, error messages, or accessor outputs. Test
  transcript captured at `.kota/runs/<run-id>/test.txt`.
- `pnpm typecheck` transcript at `.kota/runs/<run-id>/typecheck.txt`.
