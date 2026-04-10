# Daemon Ops Module

This directory owns the `daemon-ops` repo module — the operator-facing CLI and
supervisor surface around the daemon runtime. It also owns the daemon-facing
CLI commands: `kota events`, `kota session`, and `kota status`.

- Registers `kota daemon` CLI command with `status`, `pid`, `stop`, `reload`, `install`, `uninstall`, and `qr` subcommands.
- Registers `kota events tail` for streaming live daemon event bus events.
- Registers `kota session list` and `kota session inspect` for inspecting active daemon sessions.
- Registers `kota status` for an operational snapshot (daemon health, runs, approvals, cost).
- `install` registers the daemon as a user-level OS service (launchd on macOS, systemd on Linux); supports `--dry-run` to preview the generated unit without writing it. `uninstall` removes the service.
- `status` includes a `managed` field indicating whether the OS service is installed.
- The supervisor loop spawns a child process and restarts it on `RESTART_EXIT_CODE`.
- Actual daemon runtime lives in `src/core/daemon/daemon.ts`; this module wires it into the CLI.

