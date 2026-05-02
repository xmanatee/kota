---
id: task-fix-kota-serve-runtime-module-load-and-add-shipped
title: Fix kota serve runtime module load and add shipped CLI smoke for long-lived subcommands
status: ready
priority: p0
area: core
summary: kota serve crashes on startup with ModuleLoader.getRoutes() lifecycle error; fix the runtime load and add deterministic shipped-CLI smoke for serve and other long-lived subcommands.
created_at: 2026-05-02T15:27:33.724Z
updated_at: 2026-05-02T17:35:17.121Z
---

## Problem

`pnpm build && node dist/cli.js serve` aborts at boot with:

```
Fatal: ModuleLoader.getRoutes() requires lifecycle mode "runtime"; this loader is in "commands" mode. A "commands" loader skips onLoad / provider activation, so route handlers and module health probes would call into unregistered providers. Construct a runtime loader (loadRuntimeModules() or new ModuleLoader(config, verbose, { mode: "runtime" })) before consuming routes, control routes, or health checks.
```

Root cause is the same lifecycle trap that
`task-fix-daemon-startup-to-fully-load-runtime-module-pr` and
`task-codify-module-lifecycle-modes-so-runtime-cannot-co` closed for the
daemon command, but the fix did not extend to `kota serve`:

- `src/cli.ts` constructs `new ModuleLoader(config, false, { mode: "commands" })`.
- The `serve` subcommand is contributed by `src/modules/web/index.ts` and
  routes its action through `ctx.client.web.start(...)`.
- The local handler in `src/modules/web/web-operations.ts` calls
  `ctx.getRoutes()` to wire module HTTP routes into `startServer`.
- The new lifecycle guard from
  `task-codify-module-lifecycle-modes-so-runtime-cannot-co` correctly throws
  on that call because the loader is in commands mode.

The shipped daemon smoke
(`task-add-built-cli-daemon-smoke-coverage-for-provider-b`) covers
`node dist/cli.js daemon`, but `serve` and any other long-lived shipped
subcommand that consumes runtime contributions are not protected. Owner
quote: "kota deamon works but kota serve fails... It must work! And all
other clients too.. and there should be tests checking that everything
works!"

## Desired Outcome

- `node dist/cli.js serve` boots cleanly on a freshly built tree, listens on
  the configured port, and serves module-contributed HTTP routes from a
  fully loaded runtime context.
- The fix lives in the layer that owns the lifecycle distinction (CLI
  module loader, web module command, or a shared helper used by both
  daemon and serve), not as a per-command bypass of the lifecycle guard.
- A deterministic smoke covers the shipped `node dist/cli.js serve` path
  the same way the daemon smoke covers `node dist/cli.js daemon`: build,
  invoke, hit a provider-backed route, shut down cleanly.
- The same audit covers any other long-lived shipped CLI subcommands that
  consume runtime contributions (at minimum: `mcp-server`). If they are
  already covered, document where; if not, add coverage.

## Constraints

- Do not weaken the lifecycle guard. The guard exists to prevent partial
  module contributions from being served. The fix must give `serve` a
  fully loaded runtime context, not silence the guard.
- Preserve fast `commandsOnly` startup for ordinary subcommands. Only
  long-lived runtime hosts should pay the runtime-load cost.
- Reuse the runtime-load helper used by the daemon command instead of
  forking a parallel discovery path.
- The new smoke must run in CI without real model credentials, real
  network, or stable ports; discover the port/token through the daemon
  control file or captured stdout.
- The smoke must clean up its server process and temp project state on
  both success and failure.

## Done When

- `node dist/cli.js serve` no longer throws the lifecycle error on a
  freshly built tree and serves at least one provider-backed route end to
  end (proving `onLoad` ran).
- A deterministic test exercises the shipped `serve` CLI path, asserts
  successful boot, and would fail if `serve` ever regressed back to a
  commands-mode loader.
- The audit for other long-lived shipped CLI subcommands is recorded:
  each is either covered by an equivalent smoke or has a follow-up task
  filed with a reason.
- Existing CLI, daemon, web, and module-loader tests remain green.

## Source / Intent

2026-05-02 inbox capture (`data/inbox/kota-serve-fails.md`):

```
kota deamon works but kota serve fails:
pnpm build && node dist/cli.js serve
Fatal: ModuleLoader.getRoutes() requires lifecycle mode "runtime"; ...

that is terrible! It must work! And all other clients too.. and there
should be tests checking that everything works!
```

Owner-visible regression on a load-bearing operator command, immediately
after the lifecycle guard landed. Fixes the same bug class previously
closed for `daemon` but missed `serve`.

## Initiative

Daemon/module runtime correctness: every shipped long-lived CLI subcommand
must run from a fully loaded runtime context, with smoke coverage that
tests the same command path operators actually invoke.

## Acceptance Evidence

- Transcript at `.kota/runs/<run-id>/transcript.txt` of
  `pnpm build && node dist/cli.js serve` booting and serving a
  provider-backed route end to end (with secrets redacted).
- Test output showing the new shipped-CLI serve smoke passing.
- Notes in the run artifact identifying the audit result for other
  long-lived shipped subcommands (`mcp-server` and any others
  surfaced during the audit).
