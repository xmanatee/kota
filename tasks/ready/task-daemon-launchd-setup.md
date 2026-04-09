---
id: task-daemon-launchd-setup
title: Add kota daemon install command to register the daemon as a launchd/systemd service
status: ready
priority: p2
area: operator-ux
summary: Operators must manually configure launchd (macOS) or systemd (Linux) to keep the KOTA daemon running after reboot. A `kota daemon install` command that generates and loads the appropriate service unit removes a manual setup step and prevents silent daemon outages.
created_at: 2026-04-09T00:30:00Z
updated_at: 2026-04-09T02:03:33Z
---

## Problem

The KOTA daemon is a long-running process that operators typically want to survive
reboots and restart on crash. Today there is no first-class command for this: the
docs tell operators to configure their OS process manager manually. This is a friction
point for new users and a common source of silent outages when the daemon exits
unexpectedly and nothing restarts it.

## Desired Outcome

`kota daemon install` command that:
- Detects the OS (macOS → launchd, Linux → systemd user service)
- Generates the appropriate service unit file with the correct working directory,
  exec path, and environment from the current config
- Loads/enables the service and reports the status
- `kota daemon uninstall` removes the service unit and unloads it
- Dry-run mode (`--dry-run`) prints the generated unit without installing

## Constraints

- macOS: writes a `com.kota.daemon.plist` to `~/Library/LaunchAgents/` and calls
  `launchctl load`.
- Linux: writes a `kota-daemon.service` to `~/.config/systemd/user/` and calls
  `systemctl --user enable --now`.
- Does not require `sudo`; uses user-level service managers only.
- Fails gracefully with a clear error when the OS is unsupported (Windows, etc.).
- The generated service unit must include `KOTA_PROJECT_DIR` so the daemon starts in
  the correct project directory.
- `kota daemon status` should indicate whether the service is managed via the OS
  process manager.

## Done When

- `kota daemon install` registers and starts the daemon as a user service on macOS and Linux.
- `kota daemon uninstall` removes the service unit cleanly.
- `--dry-run` prints the generated unit without modifying the system.
- The command is documented in `docs/DAEMON.md`.
