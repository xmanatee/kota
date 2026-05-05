---
id: task-split-daemon-class-into-per-lifecycle-phase-handle
title: Split Daemon class into per-lifecycle-phase handler files
status: ready
priority: p1
area: core
summary: Split Daemon (core/daemon/daemon.ts) into per-lifecycle-phase sibling files so daemon.ts drops well under the 300-line guideline
created_at: 2026-05-05T10:38:51.353Z
updated_at: 2026-05-05T10:38:51.353Z
---

## Problem

`src/core/daemon/daemon.ts` is 666 lines — now the largest non-test file in
`src/core/daemon/` and the next-largest architectural anchor in the repo
after the recent McpServer (841 → 197) and ModuleLoader (814 → ?) splits.
The bulk is one `Daemon` class whose body owns every lifecycle-time concern
in a single shell:

- A 152-line constructor (lines 131–283) that wires up bus / run-store /
  task-store / scheduler / module-log-store init, builds the
  `WorkflowRuntime`, loads or seeds `DaemonState`, mints the bearer token,
  constructs the `DaemonChatBindingStore` plus conversation resolver,
  builds the `DaemonHandle` (with capability-readiness probe wiring and
  workflow-trigger-row aggregation inline), registers three provider seams
  (`workflow-dispatcher`, `workflow-metrics-source`,
  `workflow-definitions`) directly against the global provider registry,
  and finally constructs the `DaemonControlServer` with its `chatPool`,
  `makeAgent`, and contributed-route options.
- A 122-line `start()` method (lines 286–408) that registers signal
  handlers, runs the single-instance check, validates workflow
  definitions, emits config-warnings, starts the control server, writes
  `daemon-control.json`, schedules the session-sweep and
  module-health-check timers, calls `subscribeDaemon` with eight
  inline-built callbacks (including the `onWorkflowCompleted` body that
  mutates `DaemonState`, saves it, and triggers `maybeRestart`),
  installs a `NotificationGate` if quiet hours are configured, starts the
  `WorkflowRuntime`, builds the `ChannelStartContext`, drives the channel
  start loop, and finally enters the keep-alive loop.
- Two near-identical teardown paths (`stop`, lines 410–452, and
  `cleanupFailedStart`, lines 627–661) that share ~85% of their bodies
  (timer clears, channel-stop loop, workflows.stop, controlServer.stop,
  control-file removal, unsubscribe, notification-gate disposal, signal
  handler removal). The two paths drift independently — `stop` calls
  `workflows.stop(gracePeriodMs)` and saves state and logs;
  `cleanupFailedStart` calls `workflows.stop(1, 1_000)` and skips both —
  and any future teardown step has to be added to both bodies, by hand,
  or one will silently drift.
- Inline persistence (`loadState`, `saveState`, `STATE_FILE`,
  `CONTROL_FILE`) for two distinct on-disk surfaces.
- A 45-line `ensureSingleInstance` that owns control-file probing,
  PID-alive check, HTTP `/health` probe with abort timer, and stale-file
  cleanup with three different log-message paths.
- A 35-line `startChannel` that owns the channel-create / start /
  failure-status branching with three independent `channelStatuses.push`
  paths.
- Restart wiring (`requestRestart`, `maybeRestart`,
  `RESTART_EXIT_CODE`) that mutates dispatch-paused state and shells back
  through `stop()`.

Every recent daemon-surface migration has accreted another inline phase or
field on this class. The 2026-03-19 `task-split-daemon-ts.md` trimmed
daemon.ts to ≤300 lines by extracting startup/shutdown helpers, but the
`Daemon` class itself was never carved up; the file has grown back to 666
through subsequent control-server / chat-pool / capability-readiness /
provider-seam / channel-start / health-check additions. Without a
per-phase seam the next migration cluster will repeat the same accretion,
and the two-path teardown will continue to drift.

The directory already establishes the right convention. `daemon-state.ts`,
`daemon-handle.ts`, `daemon-subscriptions.ts`, `daemon-logger.ts`,
`daemon-chat-bindings.ts`, `daemon-control-*.ts`, `notification-gate.ts`,
`scheduler.ts`, `session-sweep.ts`, `task-store.ts`,
`capability-readiness.ts`, `metrics-source-provider.ts`, and
`event-ring-buffer.ts` already live as siblings; the `daemon-*.ts` and
per-concern sibling seam is already established here. The class itself is
what hasn't been split.

## Desired Outcome

`src/core/daemon/daemon.ts` is a thin orchestrator: the `Daemon` class
shell that owns the per-instance state fields and exposes the public
surface (`constructor`, `start`, `stop`, `getState`, `isRunning`,
`hasActiveWorkflow`, `getDashboardSnapshot`, `getChannelStatuses`), the
top-level `start()` that calls each startup-phase function in order, the
top-level `stop()` that calls a single unified teardown function, and the
public type re-exports (`DaemonControlAddress`, `DaemonState`,
`DaemonConfig`, `RESTART_EXIT_CODE`).

Every cohesive lifecycle-time concern lives in its own sibling file. The
intended seam (builder picks the exact file boundaries; this names the
shape, not the partition) is per lifecycle-phase, not arbitrary:

- `daemon-init.ts` — constructor wiring. Owns the `DaemonInitResult`
  shape and a `buildDaemonInit(config, projectDir, stateDir, log,
  getStateRef, getModuleHealthChecksRef, getChannelStatusesRef,
  isRunningRef)` entry point that builds the `WorkflowRuntime`,
  `DaemonChatBindingStore`, conversation resolver, `DaemonHandle` (with
  the capability-readiness probe + workflow-trigger-row aggregation
  collapsed into a typed helper), the dispatcher / metrics-source /
  definitions-source provider registrations, and the
  `DaemonControlServer`. The class constructor reduces to: load state,
  mint token, init bus/run-store/task-store/scheduler/module-log,
  delegate to `buildDaemonInit`, store the returned handles.
- `daemon-instance-lock.ts` — `ensureSingleInstance` plus the
  `daemon-control.json` read/write/remove helpers. Owns the
  `CONTROL_FILE` constant and the HTTP `/health` probe. The class calls
  `acquireInstanceLock(stateDir, log)` from `start()` and
  `releaseInstanceLock(stateDir)` from the unified teardown.
- `daemon-state-persistence.ts` — `loadState` / `saveState` /
  `STATE_FILE`. The class calls `loadDaemonStateFromDisk(stateDir)` in
  the constructor and `saveDaemonStateToDisk(stateDir, state)` from
  every state-mutating site.
- `daemon-startup.ts` — startup-phase orchestrator and per-phase
  helpers. Owns `runDaemonStartup(daemon-context)` which sequences:
  signal-handler install, `ensureSingleInstance`, workflow validation,
  config-warnings emit, control-server start + control-file write,
  session-sweep + health-check timer install, `subscribeDaemon` wiring
  (with `onWorkflowCompleted` / `onRestartRequested` extracted as named
  callbacks the daemon supplies), notification-gate install,
  `workflows.start()`, channel start loop, and finally enters the
  keep-alive loop. Each phase is exported as a small typed function the
  orchestrator calls in order; the orchestrator does not hold per-phase
  logic inline.
- `daemon-shutdown.ts` — single unified teardown. Owns
  `runDaemonShutdown(daemon-context, options: { workflowsStopArgs })`
  which stops timers, channels, workflows (with the supplied args),
  control server, removes the control file, unsubscribes, disposes the
  notification gate, removes signal handlers, and (when not in
  failed-start mode) saves state + logs the "Daemon stopped" line. The
  class's `stop()` and former `cleanupFailedStart()` collapse into a
  single call site each — the failed-start path passes
  `workflowsStopArgs: [1, 1_000]` and `saveState: false`, the normal
  path passes `[gracePeriodMs]` and `saveState: true`.
- `daemon-channel-start.ts` — `startChannel(def, channelCtx,
  channelStatuses, activeChannels, log)`. Owns the create / start /
  failure / disabled / not-applicable status-push branching as one typed
  function. The startup-phase channel loop calls it in sequence.

The orchestrator (`daemon.ts`) dispatches by phase to the per-phase
functions, passing whatever cross-cutting state is required (the
per-instance state fields, the logger, the workflows handle, the
control server, the bus, the notification gate). The class owns the
typed state fields and the public surface; the phase files own the
lifecycle-time computation. `daemon.ts` is well under the 300-line
guideline (target: ≤ 250 lines).

The split is per lifecycle-phase, not arbitrary. Each new file has one
reason to change (one lifecycle-phase concern) and one set of
dependencies. The behaviour is unchanged — same startup order, same
teardown order, same single-instance check, same control-file path,
same `daemon-state.json` schema, same `RESTART_EXIT_CODE`, same
`onWorkflowCompleted` state mutation, same channel-status reporting,
same log-line text. The two-path teardown drift is closed by
construction.

## Constraints

- Keep daemon behaviour byte-identical for every observable surface.
  Startup ordering (signal handlers → single-instance → workflow
  validation → config warnings → control server start → control-file
  write → sweep timer → health-check probe + timer → subscribeDaemon →
  notification gate → workflows.start → channel start → keep-alive),
  the exact log text on `Daemon starting...`, `Control API on
  http://127.0.0.1:<port>`, `Notification gate active: quiet hours
  …`, `Daemon ready (pid <pid>): N workflows, M scheduled items, poll
  Xs`, `Daemon shutting down...`, `Daemon stopped.`, the
  single-instance log text (`Removing stale control file`,
  `Control file references pid X (alive) but port Y is unreachable`,
  `Control file references pid X (alive) but has no port`,
  `Another daemon instance is already running`), the channel-status
  log text (`Channel started`, `Channel failed during create`,
  `Channel failed during start`, `Channel failed`,
  `Channel <status>`), the `Restarting daemon: <reason>` text, and
  every accessor's return shape stay unchanged.
- Existing `daemon-control.test.ts`, `client-contract.test.ts`,
  `client-identity.test.ts`, `daemon-state.test.ts`,
  `daemon-external-project.test.ts`, `notification-gate.test.ts`,
  `module-crash-alert.test.ts`, `event-ring-buffer.test.ts`,
  `session-sweep.test.ts`, `capability-readiness.test.ts`,
  `daemon-logger.test.ts`, the daemon integration tests, and the
  wider `core/daemon` test suite must pass without edits to
  assertions about daemon behaviour.
- The unified teardown closes the `stop` vs `cleanupFailedStart`
  drift by construction. There is one teardown body, parameterised on
  `workflowsStopArgs` and `saveState`. Do not leave the
  `cleanupFailedStart` body alive; the class's failed-start handling
  reduces to one call into the unified teardown with the
  failed-start parameters.
- Use plain functions or small classes, whichever the phase
  naturally wants. Do not introduce a parallel `BasePhase`
  abstraction or a second registry — `daemon.ts` is the one
  orchestrator, and per-phase files expose typed functions it calls.
  No DSL.
- The provider-registry registrations (`WORKFLOW_DISPATCHER_PROVIDER_TYPE`,
  `WORKFLOW_METRICS_SOURCE_PROVIDER_TYPE`,
  `WORKFLOW_DEFINITIONS_PROVIDER_TYPE`) must continue to fire from
  daemon constructor time, with the same dispatcher / metrics-source
  / definitions-source shapes as today. The seam moves into
  `daemon-init.ts`; the registration order does not change.
- The capability-readiness probe inside the `DaemonHandle` (which
  aggregates the registry probe with the `workflow.trigger` row from
  `workflows.getDefinitions()`) must keep its current behaviour,
  including the empty-definitions, all-disabled, and partial-enabled
  paths. The test `capability-readiness.test.ts` plus any
  `client-contract.test.ts` assertion about the trigger row must
  pass without edits.
- Public type re-exports at the top of `daemon.ts`
  (`DaemonControlAddress`, `DaemonState`) and the value exports
  (`DaemonConfig`, `RESTART_EXIT_CODE`, `Daemon`) stay where they
  are. Do not change consumer import paths.
- Per the `simplest, clearest, most maintainable final system` rule,
  prefer a larger cohesive change over a partial split that leaves a
  half-divided daemon. Split every clearly-owned lifecycle-phase
  concern in this task, not just the easiest one or two.
- No backwards-compatibility shim, alias re-exports, deprecated
  method stubs, or "moved to X" comments. Delete the old methods
  cleanly.
- Drop ad-hoc cleanup (e.g. unused imports, redundant `private`
  methods that only forward) that the split exposes. Do not leave
  dead code in the orchestrator.
- The session registry is owned by the daemon instance, not a
  sibling file, because the registry is shared mutable state that
  `DaemonControlServer.makeAgent`, `subscribeDaemon`, and
  `session-sweep` all need a live reference to. Pass the `Map`
  through to phase helpers; do not extract it into a separate
  store.
- `RESTART_EXIT_CODE` and the `requestRestart` / `maybeRestart`
  pair stay on the orchestrator; restart is not a lifecycle phase,
  it is a recurring check the keep-alive loop drives. Do not
  extract it.

## Done When

- `wc -l src/core/daemon/daemon.ts` reports ≤ 250 lines.
- Each new sibling phase file is at or under the 300-line guideline.
  No new file ships at >300.
- `pnpm test` passes against the full repo test suite with no
  edited assertions about daemon behaviour, log-line text, or
  accessor outputs.
- `pnpm typecheck` and the lint gate pass.
- `src/core/daemon/AGENTS.md` is updated to name the per-lifecycle-phase
  file convention as the way new daemon lifecycle concerns land — one
  file per phase, dispatched from the central `daemon.ts`. The unified
  teardown contract (one body, parameterised on
  `workflowsStopArgs` and `saveState`) is named so future contributors
  do not reintroduce the drift.
- A short `wc -l src/core/daemon/daemon*.ts` snapshot before / after
  ships in the run directory so the size collapse is visible.

## Source / Intent

Identified by explorer run `2026-05-05T10-36-56-807Z-explorer-nx8rja`
after the ModuleLoader split (`task-split-moduleloader-class-into-per-load-phase-handl.md`,
done 2026-05-05) collapsed the previous-largest-file anchor (`module-loader.ts`
814 → split via per-load-phase handler files). With that anchor done, the
next-largest non-test file in `src/core/` is `src/core/daemon/daemon.ts`
at 666 lines — a single class that bundles every lifecycle-time concern
(workflow-runtime construction, daemon-handle wiring with
capability-readiness aggregation inline, three provider-seam
registrations, control-server construction with chat-pool / makeAgent
options, signal-handler install, single-instance check, control-file
write, sweep + health-check timers, subscribeDaemon callbacks, notification
gate, channel start loop, two near-identical teardown paths, state
persistence) and grows by one inline phase per new daemon-surface
migration. Three strategic blocked alternatives all carry operator-only
preconditions (operator-capture for coding-task parity artifact,
capability-installed for auth-walled source access, operator-capture for
the rich CLI rendering peer-CLI comparison) and cannot be unblocked
autonomously; this task is autonomously actionable, beats them on
"available next step" grounds, and continues the recent direction of
shrinking the largest architectural anchors toward the 300-line
guideline. A 2026-03-19 split (`task-split-daemon-ts.md`) trimmed the
file to 311 → 300 by extracting startup/shutdown helpers, but the
`Daemon` class itself was never carved up; the file has accreted back to
666 lines through subsequent control-server / chat-pool /
capability-readiness / provider-seam / channel-start / health-check
additions, so the per-phase seam is needed to keep future clusters from
rebuilding the same monolith.

## Initiative

Module-first / core-shrinking architecture: the lifecycle phases are
naturally per-concern, the directory already established
`daemon-state.ts` / `daemon-handle.ts` / `daemon-subscriptions.ts` /
`daemon-logger.ts` / `daemon-chat-bindings.ts` / `daemon-control-*.ts`
as the split convention, and this task brings the central `daemon.ts`
into line with the rest of the directory. The unified teardown closes a
real drift-prone duplication between `stop` and `cleanupFailedStart`,
which is load-bearing for crash safety. Ongoing daemon-surface
migrations (capability-readiness, provider seams, chat pool, channel
status) make the per-phase seam load-bearing, not cosmetic.

## Acceptance Evidence

- `wc -l src/core/daemon/daemon*.ts` snapshot before and after the
  split, captured to the run directory under
  `.kota/runs/<run-id>/daemon-wc.txt`, showing
  `daemon.ts` ≤ 250 lines and every new sibling file ≤ 300.
- Existing `src/core/daemon/daemon-control.test.ts`,
  `client-contract.test.ts`, `daemon-state.test.ts`,
  `daemon-external-project.test.ts`,
  `capability-readiness.test.ts`, `notification-gate.test.ts`,
  `session-sweep.test.ts`, `module-crash-alert.test.ts`,
  `event-ring-buffer.test.ts`, `daemon-logger.test.ts`, plus the
  broader `core/daemon` test suite passes with no assertion edits
  about daemon behaviour, log-line text, or accessor outputs. Test
  transcript captured at `.kota/runs/<run-id>/test.txt`.
- `pnpm typecheck` transcript at `.kota/runs/<run-id>/typecheck.txt`.
