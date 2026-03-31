---
id: task-kota-doctor
title: Add `kota doctor` command for runtime health diagnostics
status: ready
priority: p2
area: cli
summary: Operators debugging KOTA setup issues currently have no single command to check runtime health. A `kota doctor` command would verify daemon connectivity, extension loading, provider availability, and common misconfigurations in one pass.
created_at: 2026-03-31T03:42:35Z
updated_at: 2026-03-31T03:42:35Z
---

## Problem

When something is broken — KOTA won't start, a workflow isn't triggering, an extension
isn't loading — operators have no quick triage path. They must combine `kota daemon status`,
manual config inspection, log scanning, and trial-and-error restarts to isolate the issue.
There is no single command that says "here is what is healthy, here is what is not."

## Desired Outcome

A `kota doctor` CLI command that runs a structured health check and prints a pass/warn/fail
summary for each item:

- **Daemon**: Is the daemon running? Is the control API reachable at the expected socket/port?
- **Config**: Does `config.json` parse and validate against the schema? (Delegate to `kota config validate` logic.)
- **Extensions**: Which extensions are loaded? Any that failed to load or reported errors?
- **Providers**: Are memory, history, task, and knowledge providers initialized and reachable?
- **Workflows**: Are workflow definitions valid? Any duplicates or self-trigger loop risks?
- **Disk**: Are the `.kota/` data directories present and writable?

Exit code 0 if all checks pass; non-zero if any fail. Print a human-readable table with
status indicators so operators can copy-paste the output when filing issues.

## Constraints

- Read all data from the daemon control API (`GET /status`, `GET /workflow/definitions`) when the
  daemon is running. When offline, fall back to checking config and disk directly.
- Do not add test-only flags or bypass normal initialization paths.
- Keep the command read-only — no side effects, no mutations.
- Register the command in the existing CLI registrar pattern alongside other top-level commands.

## Done When

- `kota doctor` prints a pass/warn/fail summary covering all items above.
- Exit code reflects overall health (0 = all pass, 1 = any fail).
- Works both when daemon is running (API-backed) and when daemon is offline (config/disk checks only).
- At least one unit test covers the offline path; integration test or manual verification covers the online path.
