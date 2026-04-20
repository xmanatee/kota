---
id: task-add-user-slash-command-surface-to-chat-clients-bac
title: Add user slash-command surface to chat clients backed by skills and workflows
status: done
priority: p2
area: cli
summary: Peer agents (Claude Code, Codex, gemini-cli) expose user slash commands as a primary interaction surface; KOTA's web and macOS chat clients currently lack one. Add a single daemon-owned slash-command catalog that registers from existing skills and trigger-able workflows, then surface it consistently across chat clients.
created_at: 2026-04-19T22:17:36.848Z
updated_at: 2026-04-20T14:58:15.623Z
---

## Problem

Every peer chat-style coding agent surfaces a user slash-command palette
as a primary interaction mechanism: Claude Code (`.claude/commands` and
`/plugins`), Codex (terminal CLI), gemini-cli (`/help`, `/chat`,
checkpointing). The pattern is how operators discover and invoke
capability without leaving the conversation.

KOTA already has the underlying ingredients — module-contributed skills,
trigger-able workflows, control-API endpoints — but the chat clients
(web client, macOS menu-bar app, mobile client) have no consistent way
to expose them. A user has to either know the channel command syntax or
leave the chat to drive a workflow from the CLI. The discoverability gap
is visible the first time a non-author opens a KOTA chat client.

## Desired Outcome

- A single daemon-owned slash-command catalog exists, populated from the
  things modules already contribute (skills, trigger-able workflows,
  selected agent-ops capabilities). One source of truth, not one per
  client.
- The catalog is exposed through the existing daemon control API so any
  client can fetch the current command set, render an autocomplete /
  palette, and invoke a command.
- At least the web client and one of the native clients render the
  palette and can invoke a command end-to-end. Other clients land an
  open follow-up if they lag.
- Invocation results flow through normal session/run/event paths — no
  parallel side channel for slash commands.
- The catalog respects autonomy mode and approval-queue policy. A
  command that would require a non-safe tool follows the same
  supervision rules as any other tool call.

## Constraints

- Module-first: the catalog and its registration shape live in a
  module (likely `agent-ops` or a small new `commands` module), not in
  core. Core stays protocol-oriented.
- Do not invent a parallel registry alongside skills/workflows. The
  catalog reflects what already exists; it does not become a third
  ownership surface for capability.
- Do not duplicate command state into each client. Clients query the
  daemon; they do not read repo files directly.
- Respect existing module boundaries and autonomy/approval rules.
- Keep the surface small: a slash command is name + short description +
  invocation handle. No per-command UI DSL.
- Do not block on the multi-project work; the first pass can land
  scoped to the active project.

## Done When

- The daemon control API has typed endpoints for listing the
  slash-command catalog and invoking a command.
- The catalog populates automatically from modules' contributed skills
  and trigger-able workflows; no per-command registration boilerplate
  in clients.
- The web client and at least one native client render the palette and
  can invoke a command end-to-end.
- Invocations flow through normal session/run/event paths and obey
  current autonomy / approval-queue rules.
- The relevant module's `AGENTS.md` describes the model (catalog
  source-of-truth, invocation contract, supervision behavior) at the
  conventions level, not as a catalog of specific commands.
