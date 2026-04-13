---
id: task-make-module-load-failure-policy-explicit
title: Make module load failure policy explicit and strict
status: backlog
priority: p1
area: modules
summary: Module load failures are recorded while loading continues, but the runtime does not clearly distinguish required project modules from optional installed integrations.
created_at: 2026-04-13T11:16:25Z
updated_at: 2026-04-13T11:16:25Z
---

## Problem

`ModuleLoader.loadAll()` catches module load errors, records them, and continues.
That is useful for optional integrations, but it can hide broken project-owned
modules and leave the daemon running with an incomplete capability surface. A
strict module-first architecture needs a clear failure policy: some modules are
required for the local project runtime, while some installed integrations may
be optional or inactive because credentials are missing.

Right now that distinction is implicit and inconsistent.

## Desired Outcome

Module load failure behavior is explicit and enforced. Required project modules
fail loudly when malformed. Optional installed modules can report inactive or
failed health without pretending to be loaded. Operators and autonomous agents
can tell which case occurred from module summaries and daemon startup behavior.

## Constraints

- Do not make missing credentials for optional service integrations crash the daemon.
- Do not let malformed project-owned module definitions silently disappear.
- Do not add another registry of required module names if the distinction can be
  derived from discovery source or module metadata.
- Preserve clear health reporting for inactive integrations.

## Done When

- Project-owned module definition/load failures are treated as hard startup or validation errors unless explicitly marked optional.
- Optional installed modules have clear inactive/failed status in module summaries.
- Tests cover project module load failure, optional integration inactivity, and malformed module definitions.
- Daemon and CLI output make incomplete module loading obvious.
