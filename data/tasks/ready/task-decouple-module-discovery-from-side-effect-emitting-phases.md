---
id: task-decouple-module-discovery-from-side-effect-emitting-phases
title: Decouple module discovery from side-effect emitting phases
status: ready
priority: p1
area: architecture
summary: Separate the passive discovery of module capabilities (commands, routes, tools) from their active initialization and execution, preventing side effects like repetitive warnings during the CLI's discovery phase.
created_at: 2026-04-28T14:25:00.000Z
updated_at: 2026-04-28T14:25:00.000Z
---

## Problem

The CLI exhibits repetitive warning spam (e.g., from `github-webhook` about missing secrets) during startup and daemon restarts. This happens because the `ModuleLoader` executes module-defined functions like `mod.routes(ctx)` and `mod.commands(ctx)` to discover what capabilities exist.

Architecturally, these functions are being treated as pure "manifests," but in practice, they contain active logic and side effects (logging). Because the CLI must discover all commands at startup to populate the help system and command router, these side effects are triggered on every run, even if the user isn't using the specific module. This is amplified during daemon restarts where the supervisor loops and re-initializes the CLI process multiple times.

## Desired Outcome

The system should separate "what capabilities exist" from "activating those capabilities." 
- Discovery (reading routes/commands) should be as close to side-effect-free as possible.
- Warnings about missing configuration for optional features should be deferred until those features are actually exercised, or should only be emitted during a specific "validation" or "full runtime" phase.

## Constraints

- Do not lose the ability to warn the user about missing configuration; only control *when* and *how often* it happens.
- Maintain the functional registration model (`mod.routes(ctx)`) but guide modules away from emitting logs during this phase.
- Coordinate with `task-codify-module-lifecycle-modes-so-runtime-cannot-co.md` to ensure lifecycle-specific contexts are respected.

## Done When

- `node dist/cli.js` (and variants like `daemon` or `serve`) starts with clean output, free from repetitive warnings from unconfigured optional modules.
- `ModuleLoader.getRoutes()` and `getCommands()` can be called without triggering log emissions for unconfigured but otherwise healthy modules.
- Validation warnings (like missing secrets) are still available to the operator, perhaps via a `kota doctor` check or a one-time "onLoad" warning during full daemon boot.
- The `github-webhook` warning spam is specifically resolved as a primary test case.

## Source / Intent

A 2026-04-28 investigation into "daemon restart spam" revealed that the architecture conflates discovery with execution. The owner requested a structural fix that prevents discovery-time side effects from cluttering the operator's view.

## Initiative

Module lifecycle integrity: separate discovery from activation.

## Acceptance Evidence

- Transcript showing a clean daemon restart loop (triggered by a workflow) without repeated `github-webhook` warnings.
- Proof that the warnings still appear when relevant (e.g., during `kota doctor` or when the module's `onLoad` runs in full-runtime mode).
