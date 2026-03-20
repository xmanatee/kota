---
id: task-workflow-manual-queue
title: Allow manually queuing a workflow run from the CLI
status: backlog
priority: p3
area: cli
summary: Add a `kota workflow trigger <name>` command to manually enqueue a workflow run, useful for debugging autonomous behavior or forcing a cycle without waiting for a natural trigger event.
created_at: 2026-03-20
updated_at: 2026-03-20
---

## Problem

The workflow runtime only starts runs in response to events (bus events, idle timer). There is no way for an operator to manually force a workflow run without restarting the daemon or injecting a raw event. This makes debugging and on-demand re-runs difficult.

## Desired Outcome

A `kota workflow trigger <name>` (or similar) CLI command that:
- Enqueues a named workflow with a `manual` trigger event
- Respects cooldown — warns if the cooldown period hasn't elapsed (but allows `--force` to override)
- Works by writing to the persistent queue file or emitting on the bus if the daemon is running

## Constraints

- Must not bypass guardrails or permission modes — the queued run follows normal execution rules
- If the daemon is not running, the queued run should persist and start on next daemon startup

## Done When

- `kota workflow trigger <name>` successfully enqueues a run
- The queued run executes and produces normal run artifacts
- Cooldown check and `--force` flag work correctly
