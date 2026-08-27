---
status: done
---

# Restore runtime module event subscriptions and scoped issue routing

## Problem

Runtime-mode module loading currently executes every module `onLoad` hook while
`ModuleLoader.bus` is still `null`. `ModuleEventProxyImpl.subscribe` and
`subscribeExternal` silently return no-op unsubscribe functions in that state.
The daemon creates its `EventBus` only afterward and never calls
`loader.setBus`, so subscriptions installed by autonomy, tracing, email,
webhook, guardrail audit, push notifications, inbound signals, and other
runtime modules do not exist in the live daemon.

This invalidates the P0 replacement delivered by commit `634e84ef0`: the four
polling escalator workflows were removed, but the source-owned subscribers
that should replace them cannot observe workflow failures, trajectory
diagnostics, owner-question changes, dead-letter changes, or interrupted
builders. The live event journal contains no `autonomy.issue.*` or
`workflow.dead-letter.changed` events despite qualifying failures and open
DLQs.

There is a second correctness issue behind the inactive path. Autonomy's
subscriber is created once with the default module `ctx.cwd`; several handlers
then read run, owner-question, dead-letter, and issue state from that directory
even when an event carries another `projectId`. Activating this path without
scoped store resolution would allow one hosted scope's event to inspect or
mutate another scope's state.

## Desired Outcome

Give runtime module events one explicit lifecycle and ownership model. A
runtime loader must receive the exact host `EventBus` before any `onLoad` hook
runs, and module subscriptions must be installed once, remain active for the
host lifetime, and be removed on unload. Missing runtime event authority must
fail initialization rather than degrade to silent no-op behavior.

Make autonomy issue-source processing scope-correct. Every event resolves its
originating project/scope through the daemon runtime registry and reads or
writes only that scope's runs, DLQs, owner questions, issue projection, and
artifacts. The repaired source path must restore evidence-driven issue
decisions without bringing back the deleted periodic escalators.

## Constraints

- Fix the shared runtime loader/host lifecycle contract, not autonomy-only
  subscription retries or a delayed-registration fallback.
- Use one `EventBus` instance across runtime module loading, daemon middleware,
  project runtimes, journaling, and subscribers. Do not create parallel buses
  or replay startup events to compensate for ordering.
- Runtime-mode loading must reject an absent bus before `onLoad`; command-mode
  loading remains side-effect-free and does not need a bus.
- Preserve unload/reload ownership. Every installed listener has one owner,
  is removed exactly once, and is not duplicated across daemon restart or
  module reload.
- Resolve event scope through the canonical scope/project runtime registry.
  Do not use the default `ctx.cwd` as a fallback for an explicit foreign or
  unresolved `projectId`; reject or dead-letter invalid scope selectors.
- Keep source-owned issue subscriptions and the single `improver` decision
  workflow introduced by `634e84ef0`. Do not restore the four deleted generic
  escalators or add periodic polling.
- Remove the silent missing-bus behavior from runtime `emit`, `subscribe`, and
  `subscribeExternal`; event loss must be observable and initialization must
  fail before the daemon advertises readiness.

## Done When

- Every production `loadRuntimeModules` caller supplies a valid event
  authority before module lifecycle execution, and the daemon uses that same
  bus for its runtime, middleware, journal, workflow runtimes, and module
  contexts.
- A real daemon startup installs module `onLoad` subscribers before any
  workflow can emit events; listener counts and emitted evidence prove the
  subscriptions are active.
- Workflow failure, trajectory/review scrutiny, owner-question change,
  dead-letter change, and builder interruption signals reach the autonomy
  issue projection and request one deduplicated improver decision when their
  source contract calls for it.
- Two hosted scopes emitting interleaved source events update only their own
  issue, run, DLQ, owner-question, and artifact stores. Unknown or conflicting
  scope identities fail explicitly without touching the default scope.
- Module unload/reload and daemon restart leave one listener per declared
  subscription with no leaks, duplicate issue emissions, or replayed stale
  events.
- Runtime module event methods cannot silently swallow a missing bus, and all
  affected modules use the repaired shared lifecycle without local guards or
  compatibility paths.

## Source / Intent

Created during the 2026-08-14 daemon health audit after P0 builder run
`2026-08-13T22-34-01-180Z-builder-yttyo9` completed the escalator replacement.
Security-review run
`2026-08-14T00-06-01-650Z-security-review-8ca8tr` revalidated the exact
lifecycle defect in `security-review-revalidation.json`: `loadRuntimeModules`
runs `onLoad` with `bus=null`, subscriptions become permanent no-ops, and the
daemon creates its bus afterward without wiring it back. Manual inspection of
`src/modules/daemon-ops/index.ts`, `src/core/modules/runtime-loader.ts`,
`src/core/modules/module-context.ts`, and
`src/core/daemon/daemon-context-factory.ts` confirms that call order.

This is P0 because commit `634e84ef0` intentionally removed the prior
escalators in favor of this inactive path. Dispatch was paused without
interrupting the healthy active P1 builder so no further work runs without the
new failure/decision control plane.

## Initiative

Evidence-driven autonomy issue routing with one runtime event mechanism.

## Acceptance Evidence

- A focused lifecycle fixture starts the production runtime loader and daemon
  assembly path, emits one event for each affected source family, and records
  active listener counts plus resulting issue/decision artifacts.
- A two-project daemon fixture emits interleaved failures, DLQ changes, owner
  answers, and trajectory artifacts, then proves byte-for-byte that each
  scope's state changes only under its own project directory.
- Reload/restart/unload evidence records listener counts before and after each
  transition and proves no duplicate handlers or duplicate issue emissions.
- A negative fixture proves runtime loading and runtime event operations fail
  clearly when no bus or no valid event scope exists.
- A trusted-host live probe after daemon restart captures a qualifying source
  event, its `autonomy.health.signal`, the projected issue, and the single
  `autonomy.issue.decision-requested` handoff in the event journal.
