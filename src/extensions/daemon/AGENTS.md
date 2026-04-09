# Daemon Extension

This directory owns the `daemon` built-in extension — long-running KOTA process with supervisor and built-in workflow/channel resolution.

- Registers `kota daemon` CLI command with `status`, `pid`, `stop`, `reload`, `install`, and `uninstall` subcommands.
- `install` registers the daemon as a user-level OS service (launchd on macOS, systemd on Linux); supports `--dry-run` to preview the generated unit without writing it. `uninstall` removes the service.
- `status` includes a `managed` field indicating whether the OS service is installed.
- The supervisor loop spawns a child process and restarts it on `RESTART_EXIT_CODE`.
- Actual daemon runtime lives in `src/scheduler/daemon.ts`; this extension wires it into the CLI.

## Files

- `index.ts` — `KotaExtension` definition; CLI command, supervisor loop, and `buildDaemonChildArgs`/`resolveDaemonWorkflowDefinitions` helpers. Exports `buildLaunchdPlist`, `buildSystemdUnit`, `writeServiceFile`, `removeServiceFile` as testable boundaries for install/uninstall actions.
- `index.test.ts` — unit tests for daemon command registration and supervisor helpers.
- `install.test.ts` — structural and lifecycle tests for `install`/`uninstall`: launchd plist and systemd unit content assertions, round-trip file lifecycle, and double-install/double-uninstall error cases. Writes to a temp directory; no `launchctl` or `systemctl` calls.
