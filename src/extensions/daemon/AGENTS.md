# Daemon Extension

This directory owns the `daemon` built-in extension — long-running KOTA process with supervisor and built-in workflow/channel resolution.

- Registers `kota daemon` CLI command with `status`, `pid`, `stop`, and `reload` subcommands.
- The supervisor loop spawns a child process and restarts it on `RESTART_EXIT_CODE`.
- Actual daemon runtime lives in `src/scheduler/daemon.ts`; this extension wires it into the CLI.

## Files

- `index.ts` — `KotaExtension` definition; CLI command, supervisor loop, and `buildDaemonChildArgs`/`resolveDaemonWorkflowDefinitions` helpers.
- `index.test.ts` — unit tests for daemon command registration and supervisor helpers.
