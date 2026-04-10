# Daemon Core

This directory contains the daemon host, control API, scheduler persistence,
and live runtime state.

- Keep daemon runtime ownership here: process lifecycle, control-plane hosting,
  session/channel hosting, scheduling, and runtime state.
- Autonomous workflow execution belongs in `src/core/workflow/`, not in ad hoc
  daemon behavior.

