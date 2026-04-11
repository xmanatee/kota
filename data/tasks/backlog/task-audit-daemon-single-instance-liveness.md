---
id: task-audit-daemon-single-instance-liveness
title: Audit daemon single-instance and liveness handling
status: backlog
priority: p2
area: daemon
summary: Recent process inspection suggested possible duplicate daemon processes; daemon startup and status should make single-instance liveness unambiguous.
created_at: 2026-04-11T01:44:06Z
updated_at: 2026-04-11T01:44:06Z
---

## Problem

The control API currently reports the daemon as healthy, but recent process
inspection showed more than one `node dist/cli.js daemon`-like process. That may
be harmless wrapper state, an old process, or a real duplicate daemon risk.

If multiple daemon instances can write `.kota/` state at once, autonomous runs
can become hard to reason about.

## Desired Outcome

Daemon startup, status, and doctor checks should make it clear whether exactly
one daemon owns the project runtime state.

## Constraints

- First determine whether duplicate-looking processes are real daemon owners or
  harmless parent/wrapper processes.
- Prefer improving existing daemon status/doctor/startup checks over adding a
  new process-management system.
- Do not use destructive process cleanup in normal validation.
- Preserve restart behavior for legitimate daemon self-restarts.

## Done When

- It is clear from `kota status` or `kota doctor` whether the project has one
  live daemon owner.
- Stale control files and duplicate live owners are reported distinctly.
- Existing daemon restart recovery still works.
