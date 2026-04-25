---
id: task-add-interactive-runtime-navigator-as-a-cli-module
title: Add interactive runtime navigator as a CLI module
status: done
priority: p2
area: architecture
summary: Build the interactive runtime navigator as a new src/modules/cli/ module that consumes the KotaClient contract to inspect and toggle sessions, modules, logs, agents, secrets, and approvals.
created_at: 2026-04-25T12:47:35.871Z
updated_at: 2026-04-25T21:47:41.232Z
---

## Problem

The KOTA CLI today is a flat list of one-shot subcommands. There is no
single place an operator can browse and toggle live runtime state —
sessions, modules, logs, agents, secrets, the approval queue — without
remembering and chaining several commands. The owner's inbox capture
calls this out explicitly: "ideally it should be interactible so that i
can navigate inside and change settings and view stuff and enable/disable
stuff... e.g. logs, sessions, agents, modules, secrets, e.t.c.".

There is no operator-facing navigator client yet, and no module under
`src/modules/` that owns interactive runtime browsing as a capability.

## Desired Outcome

- A new `src/modules/cli/` module owns the interactive runtime navigator.
  The navigator launches via a clear entrypoint (e.g. `kota navigate`,
  or the bare `kota` invocation when no prompt is given and stdin is a
  TTY — pick one and document it).
- The navigator routes every read and toggle through the `KotaClient`
  contract from `task-define-kota-client-contract-and-route-every-cli-su`.
  No direct `.kota/` reads, no second access path, no parallel
  rendering layer.
- At minimum, the navigator lets the operator inspect:
  - active sessions (and toggle autonomy mode where the contract
    permits),
  - loaded modules (and enable/disable workflows the daemon owns),
  - recent logs / events,
  - registered agents,
  - secrets (list and remove only — never reveal values),
  - the approval queue (approve / reject pending entries inline).
- All output flows through the existing `src/modules/rendering` module
  primitives. The navigator degrades cleanly in non-TTY contexts (it
  refuses to launch and prints the equivalent one-shot subcommand
  hint).
- A scoped `AGENTS.md` for `src/modules/cli/` describes the navigator's
  responsibilities at the conventions level (not a screen-by-screen
  inventory).

## Constraints

- Do not introduce a parallel UI/CLI DSL. Composition stays in typed
  TypeScript using the existing `src/modules/rendering` primitives.
- The navigator is a consumer of `KotaClient` only. Do not have it
  reach for module services through `ModuleContext`, and do not have
  it duplicate fallbacks the contract already owns.
- The navigator must not silently bypass the daemon when one is
  running. Failures from the contract surface as errors in-place
  (e.g. "daemon not reachable"); the navigator must not fall back to
  a private local path.
- Keep the navigator module under `src/modules/cli/`. Do not put it in
  core; the root `AGENTS.md` rule for adding an operator-facing client
  is "add a `client`" — a module — not a core surface.
- Existing one-shot CLI subcommands keep working unchanged. The
  navigator is additive, not a replacement.
- The first slice does not need to cover every capability listed in
  Desired Outcome perfectly; it must at least let the operator browse
  sessions, modules, and the approval queue through the contract.
  Subsequent passes (logs, secrets, agents) can build on the same
  pattern.

## Done When

- `src/modules/cli/` exists with a typed module definition and the
  navigator entry point. The module declares its dependencies
  (rendering, plus whichever modules host the contract routes the
  navigator consumes).
- A documented launch path in `src/cli.ts` opens the navigator in TTY
  mode without breaking any existing one-shot subcommand or pipe-mode
  behavior.
- The navigator inspects and toggles at least sessions, modules, and
  the approval queue end-to-end through the `KotaClient` contract;
  logs, secrets, and agents are at least browsable.
- Recorded transcripts under `.kota/runs/` (or a checked artifact)
  show navigation across the listed capabilities against a running
  daemon.
- A scoped `AGENTS.md` for `src/modules/cli/` documents the
  navigator's purpose, the rendering and contract conventions, and
  the TTY-vs-non-TTY behavior at the conventions level.

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

This task is the operator-facing half of that capture. The architectural
contract it depends on is tracked separately as
`task-define-kota-client-contract-and-route-every-cli-su` so the two
deliverables can land coherently.

Audit grounding the decomposition and the `src/modules/cli/` placement:
`.kota/runs/2026-04-25T12-42-00-647Z-builder-loiynd/audit.md`.

## Initiative

Product-grade KOTA clients: a single daemon control contract that the CLI,
native/web/mobile apps, and future operator clients all consume the same
way, with the CLI as the reference interactive client.

## Acceptance Evidence

- A recorded transcript under `.kota/runs/` showing the navigator
  launched against a running daemon and exercising session inspection,
  module enable/disable, and approval-queue approve/reject.
- Diff showing `src/modules/cli/` registered as a project module with a
  typed module definition, scoped `AGENTS.md`, and entry-point wiring
  in `src/cli.ts`.
- Static evidence (focused test or grep) that the navigator touches no
  `.kota/` files and resolves no module services directly — only the
  `KotaClient` contract.
