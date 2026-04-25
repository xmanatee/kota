---
id: task-make-the-kota-cli-a-first-class-daemon-client-with
title: Make the KOTA CLI a first-class daemon client with an interactive runtime navigator
status: dropped
priority: p2
area: architecture
summary: Treat the CLI as a replaceable client of the daemon control API and add an interactive navigator over runtime state (sessions, modules, logs, agents, secrets).
created_at: 2026-04-25T12:26:57.655Z
updated_at: 2026-04-25T12:49:23.007Z
---

## Problem

The CLI today is a Commander program that talks to in-process state directly
for many operations and reaches the daemon only ad hoc through `daemon-client`.
There is no shared client model: each module's CLI subcommand stitches
together its own access pattern, and the operator has no interactive view to
navigate runtime state (sessions, modules, logs, agents, secrets, approvals).
That makes the CLI feel like a bag of one-shot commands rather than a real
client of the daemon, and it limits future native/web/mobile clients because
they cannot rely on the same control-plane surface the CLI uses.

The architectural concept of `client` already exists in `AGENTS.md` (a daemon
consumer that talks to the control API), but the CLI is not yet built that
way. The control API exists, modules contribute routes, and a `daemon-client`
helper exists — what is missing is a coherent client layer the CLI uses
end-to-end and an interactive navigator on top of it.

## Desired Outcome

- The CLI is a thin, replaceable client of the daemon, not a second runtime
  host. Read paths and mutations route through one daemon control surface
  (or one explicit local-fallback path when the daemon is not running) so
  every CLI command shares the same client model.
- A typed daemon-client API in core (already partially present) is the single
  contract clients use; module-contributed control routes extend it, and the
  CLI consumes them through that contract.
- An interactive mode lets the operator navigate runtime state — at minimum
  sessions, modules, recent logs, agents, secrets, approvals — and toggle or
  inspect entries inline. Non-interactive subcommands keep working unchanged.
- Output flows through the existing rendering module (no parallel formatting
  layer) and degrades cleanly in non-TTY contexts.

## Constraints

- Do not introduce a second public CLI/UI DSL. Composition stays in typed
  TypeScript using the existing rendering primitives.
- Do not duplicate `daemon-client` for the interactive surface; extend the
  one client. Module-owned routes stay declared via `KotaModule.controlRoutes`.
- Do not silently bypass the daemon when one is running. Direct `.kota/`
  reads from the CLI are only acceptable when the daemon is offline; the
  interactive surface should fail loudly rather than mix sources.
- Existing JSON / streaming-JSON paths and pipe-mode behavior must continue
  to work for scripts and CI.
- This task overlaps with the rendering task
  (`task-introduce-a-rich-cli-rendering-abstraction-for-all`) but is not the
  same: rendering owns the visual vocabulary; this task owns the architecture
  and the interactive surface. Coordinate, do not duplicate.

## Done When

- A documented client contract in `src/core/server/` (or an equivalent core
  seam) covers every CLI capability the operator needs; the CLI's
  Commander program consumes it directly.
- `kota` (or a clearly documented subcommand) launches an interactive
  navigator that routes through the client contract and lets the operator
  inspect and toggle sessions, modules, logs, agents, secrets, and the
  approval queue without raw file edits.
- All non-interactive CLI subcommands keep working and continue to use the
  same client contract; no parallel access path remains.
- Output is fully routed through the rendering module across both
  interactive and non-interactive paths.
- A scoped `AGENTS.md` documents the client/CLI/interactive boundary at the
  conventions level (no enumerations).

## Source / Intent

2026-04-25 inbox capture (`data/inbox/cli-still-feels-poor.md`,
post-"already partly processed" portion, verbatim):

> Also ideally it should be interactible so that i can navigate inside and
> change settings and view stuff and enable/disable stuff... e.g. logs,
> sessions, agents, modules, secrets, e.t.c. there should probably be some
> kind good layer in the core for API (should be extendable by modules)...
> maybe it's already like that .... but yes cli must be similar to other
> clients and use similar APIs. APIs must be really good and extendble...
> That should require lots of designing and thinking through architechture
> and probably many tasks to properly implement. we should aim for clean and
> clear and modular and extendible architechture and structure and code...
> no legacy, no redundancy and no left-overs.

The first portion of the same inbox file (about visual rendering) is already
tracked verbatim in the blocked rendering task; this task captures the
distinct architectural and interactive concerns.

## Initiative

Product-grade KOTA clients: a single daemon control contract that the CLI,
native/web/mobile apps, and future operator clients all consume the same
way, with the CLI as the reference interactive client.

## Acceptance Evidence

- Recorded transcript of the interactive navigator under `.kota/runs/` (or a
  dedicated artifact) showing session/module/log/agent/secrets/approval
  navigation against a running daemon.
- Diff showing every CLI subcommand routes through the client contract; a
  search for direct `.kota/` reads from CLI code returns only the explicit
  daemon-offline fallback path.
- Updated module-level `AGENTS.md` for the CLI/client surface describing the
  conventions (no enumerated routes or commands).

## Plan

- Audit current CLI subcommand access patterns and `daemon-client` coverage;
  list gaps.
- Decide whether the interactive navigator is a new module
  (`src/modules/cli/` or similar) or an extension of an existing surface, and
  record the decision.
- Land the client-contract consolidation first (no behavior change), then
  build the interactive navigator on top.
