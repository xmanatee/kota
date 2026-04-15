# KOTA Daemon

The KOTA daemon is a long-running process that runs autonomous workflows,
manages channels, and hosts the control API. This document covers how to
start, manage, and install the daemon as an OS service.

## Starting the Daemon

```
kota daemon
```

Options:

| Flag | Default | Description |
|------|---------|-------------|
| `--verbose` | false | Show debug output |
| `--poll-interval <s>` | 30 | Scheduler poll interval |
| `--log-format` | text | `text` or `json` |

The daemon runs as a supervisor that restarts itself on expected exit codes
(e.g., after a config reload). To stop it cleanly, use `kota daemon stop`.

## Status

```
kota daemon status [--json]
```

Prints a summary of the running daemon: PID, uptime, active/pending workflow
runs, open sessions, whether the dispatcher is paused, and whether the daemon
is managed by the OS process manager (`managed: yes/no`).

## Stopping and Reloading

```
kota daemon stop [--timeout <seconds>]
kota daemon reload
kota module reload <name>
kota daemon pid
```

- `stop` sends SIGTERM and waits up to `--timeout` seconds for a clean exit.
- `reload` hot-reloads config, reimports all module source from disk, and re-registers workflow contributions.
- `module reload <name>` reloads a single named module via the daemon (triggers a full config reload under the hood).
- `pid` prints the daemon's PID (exits non-zero if not running).

## Module Lifecycle

Three operations affect module state at runtime:

- **Reload** (`kota module reload <name>` or `kota daemon reload`): reimports
  module source from disk (ESM cache-busted), unloads the old instance, and
  re-registers the fresh module. Picks up changed source without a process
  restart. Active workflow runs are not interrupted.
- **Unload / Load**: the internal lifecycle for removing a module and
  re-adding it. Reload uses this under the hood. Unload tears down tools,
  workflows, channels, skills, agents, and config keys contributed by the
  module.
- **Daemon restart**: full process restart. Required for changes to core
  runtime code, module protocol changes, or dependency graph changes that
  reload cannot safely reconcile.

## Mobile Client QR Setup

```
kota daemon qr
```

Prints a QR code to the terminal encoding the daemon URL and auth token. Scan
this code with the KOTA mobile app to auto-fill the Settings screen without
typing the URL or token manually.

The QR payload is `{"url":"http://<local-ip>:<port>","token":"..."}`. The URL
uses the host's local network IP so the mobile device can reach the daemon on
the same network.

The daemon must be running (`kota daemon`) before using this command.

## Installing as an OS Service

`kota daemon install` registers the daemon as a user-level service so it
starts automatically on login and restarts on crash. No `sudo` required.

```
kota daemon install [--dry-run]
kota daemon uninstall
```

`--dry-run` prints the generated service unit to stdout without writing any
files or activating anything. Useful to inspect what will be installed.

### macOS (launchd)

Writes `~/Library/LaunchAgents/com.kota.daemon.plist` and calls
`launchctl load` to start the service immediately.

Logs go to `.kota/daemon.log` and `.kota/daemon.err` in the project directory.

To manually manage the service after installation:

```
launchctl unload ~/Library/LaunchAgents/com.kota.daemon.plist  # stop
launchctl load ~/Library/LaunchAgents/com.kota.daemon.plist    # start
```

### Linux (systemd user service)

Writes `~/.config/systemd/user/kota-daemon.service` and calls
`systemctl --user enable --now` to start and enable the service.

To manually manage the service after installation:

```
systemctl --user status kota-daemon
systemctl --user stop kota-daemon
systemctl --user start kota-daemon
journalctl --user -u kota-daemon -f
```

### Environment

Both service units set `KOTA_PROJECT_DIR` to the current working directory at
install time, so the daemon starts in the correct project root regardless of
the login environment.

### Uninstalling

`kota daemon uninstall` stops the service, disables it, and removes the unit
file. On Linux it also runs `systemctl --user daemon-reload` to clean up.

## Control API

When running, the daemon exposes a loopback HTTP control API documented in
[DAEMON-API.md](DAEMON-API.md). Clients and CLI commands use this API to query
status, manage approvals, inspect workflow runs, and more.

See [ARCHITECTURE.md](../AGENTS.md) for the daemon/client architecture glossary.
