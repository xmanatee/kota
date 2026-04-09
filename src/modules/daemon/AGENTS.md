# Daemon Module

This directory owns the `daemon` repo module — long-running KOTA process with supervisor and autonomy workflow/channel resolution. It also owns the daemon-facing CLI commands: `kota events`, `kota session`, and `kota status`.

- Registers `kota daemon` CLI command with `status`, `pid`, `stop`, `reload`, `install`, and `uninstall` subcommands.
- Registers `kota events tail` for streaming live daemon event bus events.
- Registers `kota session list` and `kota session inspect` for inspecting active daemon sessions.
- Registers `kota status` for an operational snapshot (daemon health, runs, approvals, cost).
- `install` registers the daemon as a user-level OS service (launchd on macOS, systemd on Linux); supports `--dry-run` to preview the generated unit without writing it. `uninstall` removes the service.
- `status` includes a `managed` field indicating whether the OS service is installed.
- The supervisor loop spawns a child process and restarts it on `RESTART_EXIT_CODE`.
- Actual daemon runtime lives in `src/scheduler/daemon.ts`; this module wires it into the CLI.

## Files

- `index.ts` — `KotaModule` definition; CLI command registration, supervisor loop, and `buildDaemonChildArgs`/`resolveDaemonWorkflowDefinitions` helpers. Exports `buildLaunchdPlist`, `buildSystemdUnit`, `writeServiceFile`, `removeServiceFile` as testable boundaries for install/uninstall actions.
- `events-cli.ts` — `buildEventsCommand`: builds the `kota events` Command with `tail` subcommand.
- `session-cli.ts` — `buildSessionCommand`: builds the `kota session` Command with `list` and `inspect` subcommands.
- `status-cli.ts` — `buildStatusCommand`, `formatStatusOutput`, `gatherStatus`, `StatusSnapshot`: builds the `kota status` Command; `gatherStatus` works both online (via daemon API) and offline (disk fallback).
- `index.test.ts` — unit tests for daemon command registration and supervisor helpers.
- `install.test.ts` — structural and lifecycle tests for `install`/`uninstall`: launchd plist and systemd unit content assertions, round-trip file lifecycle, and double-install/double-uninstall error cases. Writes to a temp directory; no `launchctl` or `systemctl` calls.
- `status-cli.test.ts` — unit tests for `formatStatusOutput` covering all output permutations.
