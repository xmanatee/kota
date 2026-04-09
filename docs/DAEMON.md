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
| `--model` | config default | Model to use for autonomous agents |
| `--verbose` | false | Show debug output |
| `--idle-interval <s>` | 30 | How often to emit `runtime.idle` |
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
kota daemon pid
```

- `stop` sends SIGTERM and waits up to `--timeout` seconds for a clean exit.
- `reload` hot-reloads config and re-registers module workflow contributions.
- `pid` prints the daemon's PID (exits non-zero if not running).

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

See [DAEMON-CLIENTS.md](DAEMON-CLIENTS.md) for the daemon/client architecture.
