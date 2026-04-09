---
id: task-daemon-lifecycle-tests
title: Add integration tests for daemon install/uninstall lifecycle
status: ready
priority: p2
area: reliability
summary: kota daemon install/uninstall shipped for launchd (macOS) and systemd (Linux) with no automated test coverage. These commands generate OS-specific service files; incorrect content or path expansion silently produces a non-functioning system service. Test coverage is a reliability gap.
created_at: 2026-04-09T02:45:00Z
updated_at: 2026-04-09T02:45:00Z
---

## Problem

`kota daemon install` and `kota daemon uninstall` generate OS-specific service
files (launchd `.plist` on macOS, systemd `.service` on Linux). The generated
file content includes environment variable injection, binary paths, log paths,
and project directory references. Errors in any of these fields produce a
daemon service that silently fails to start or restart.

No automated tests verify this output. Manual QA on each platform is the only
current check, and regressions from future refactors in the daemon extension
or config system would go undetected until a user reports a broken install.

## Desired Outcome

Integration tests run against the install/uninstall command logic and assert
the generated file content without touching the actual OS service manager
(launchd/systemd). Tests cover:

- Correct plist structure for macOS: `ProgramArguments`, `EnvironmentVariables`
  (including `KOTA_PROJECT_DIR`), `StandardOutPath`, `StandardErrorPath`,
  `RunAtLoad`, `Label`.
- Correct service unit for Linux: `[Unit]`, `[Service]` section fields
  (`ExecStart`, `Environment=`, `Restart`, `StandardOutput`, `StandardError`),
  `[Install]`.
- Uninstall removes exactly what install created; second uninstall returns a
  clear "not installed" error.
- Install when already installed returns a clear "already installed" error.

Tests write generated files to a temp directory; they do not invoke
`launchctl` or `systemctl`.

## Constraints

- Do not actually register with the OS service manager in tests.
- Platform-specific test paths (launchd vs. systemd) should either use
  platform detection to skip inapplicable tests or mock the platform selector
  so both paths run on any OS.
- Tests should live alongside the daemon extension implementation
  (`src/extensions/daemon/`).
- No new production flags or test-only conditionals in production code.

## Done When

- Tests cover install and uninstall for both launchd and systemd backends.
- File content assertions cover all required fields listed above.
- Error cases (already installed, not installed) return correct exit codes and
  messages.
- Tests pass in CI; no flakes on retry.
