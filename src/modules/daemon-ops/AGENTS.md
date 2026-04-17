# Daemon Ops Module

This directory owns the `daemon-ops` repo module — the operator-facing CLI and
supervisor surface around the daemon runtime. It also owns the daemon-facing
CLI commands.

- Keep this module focused on operator control: daemon status, lifecycle,
  service installation, live event inspection, session inspection, and a
  concise operational snapshot.
- Service integration should stay user-level and project-scoped. Do not require
  elevated privileges or create global machine state.
- Exact command names, flags, output fields, service-unit contents, and restart
  constants belong in the command implementation and tests, not docs catalogs.
- The daemon runtime itself lives in core; this module wires it into the CLI and
  supervisor surface.
