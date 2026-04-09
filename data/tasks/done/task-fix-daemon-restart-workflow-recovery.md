---
id: task-fix-daemon-restart-workflow-recovery
title: Fix daemon restart so workflow definitions and queued runs recover correctly
status: done
priority: p0
area: workflow
summary: A builder-triggered restart can bring the child daemon back up with zero loaded workflows, which then causes pending follow-up runs like improver to be discarded during queue restore. Fix the restart path so built-in workflows always load, module workflows are merged correctly, and queued runs survive restarts.
created_at: 2026-03-27
updated_at: 2026-03-27
---

## Problem

The daemon restart path is not preserving autonomous continuity correctly.

In the observed failure:

- builder completed successfully
- builder queued improver
- builder requested restart
- the restarted child daemon came back with `Workflows: 0`
- the queued improver run was then dropped during queue restore because no
  workflow definitions were loaded

This breaks the core autonomous loop and makes restart-based self-hosting
unsafe.

## Desired Outcome

- Restarted daemon children always load the built-in workflows.
- Module-contributed workflows are merged with built-ins instead of replacing
  them accidentally.
- Pending queued runs survive restart and recover if their workflow definitions
  are valid.
- If workflow definitions cannot be loaded correctly, the daemon fails loudly
  instead of silently starting with an empty workflow set and dropping queued
  work.

## Constraints

- Do not introduce a second workflow-loading path for restarts.
- Keep the workflow model strict: one canonical source of built-in workflows and
  one canonical merge point for module-contributed workflows.
- Prefer direct failure over silently discarding queued work.

## Done When

- A builder -> restart -> improver chain recovers correctly after daemon restart.
- Restarted daemons include built-in workflows even when module-contributed
  workflow lists are empty.
- Queue restore does not silently discard valid pending runs because the daemon
  started with zero definitions.
- Focused tests cover restart with built-ins only and restart with built-ins
  plus contributed module workflows.
