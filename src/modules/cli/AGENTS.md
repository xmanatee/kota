# CLI Module

This module owns the interactive runtime navigator — KOTA's operator-facing
TTY client. It is one of several KotaClient consumers; the daemon-backed
native, web, and mobile clients use the same contract through different
transports.

## Conventions

- The navigator reads and mutates runtime state exclusively through the
  `KotaClient` contract on `ModuleContext.client`. It must not import core
  module services, read `.kota/` files directly, or open its own daemon
  socket.
- Failures from the contract surface in-place. The navigator never falls
  back to a private local path when the daemon is reachable.
- Output flows through the `rendering` module's primitives and shared
  `TerminalTransport`. No bare `console.log` for operator-facing output;
  reserve `process.stderr` for diagnostic banners.
- Composition stays in typed TypeScript. Do not add a screen DSL or a
  template engine; new screens are functions over `RenderNode`.

## Behavior

- Entrypoint: `kota navigate`. The bare `kota` invocation stays on the
  prompt/REPL path; the navigator is an explicit subcommand so pipes and
  scripted callers never hit it accidentally.
- TTY-only. When `process.stdin.isTTY` is false the navigator refuses to
  launch and prints the equivalent one-shot subcommand hint so pipes,
  cron jobs, and scripted callers fail loudly instead of hanging on a
  prompt.
- The first slice covers sessions, modules, automations backed by workflow
  definitions, the approval queue, secrets (list + remove only), tasks,
  memory, knowledge, history, and owner questions. Logs/events arrive in a
  later pass on the same pattern.
- Secrets values are never rendered. The screen lists names and sources
  only; the only mutation is removal.
