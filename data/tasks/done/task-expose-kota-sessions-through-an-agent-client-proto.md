---
id: task-expose-kota-sessions-through-an-agent-client-proto
title: Expose KOTA sessions through an Agent Client Protocol adapter
status: done
priority: p2
area: modules
summary: Agent Client Protocol has become a shared JSON-RPC-over-stdio surface for editor and headless clients to drive coding agents; KOTA should expose daemon sessions through a module-owned ACP adapter instead of inventing a parallel client integration path.
created_at: 2026-05-27T03:38:33.649Z
updated_at: 2026-05-27T03:54:54Z
---

## Problem

Agent Client Protocol is turning into a shared control surface between coding
agents and editor/headless clients. The official ACP docs describe a JSON-RPC
agent/client architecture over stdio with concurrent sessions, streamed updates,
bidirectional permission requests, and MCP handoff from the client side. The
registry already lists many KOTA peer runtimes and adapters, including Claude
Agent, Codex CLI, Gemini CLI, GitHub Copilot, Goose, OpenHands, OpenClaw, and
Pi.

KOTA already has daemon-owned sessions, module-contributed channels, approval
guardrails, and MCP surfaces, but there is no ACP-facing adapter. An editor or
headless ACP client would need a bespoke KOTA integration even though the
protocol now covers the same session lifecycle KOTA already owns.

## Desired Outcome

KOTA can be launched as an ACP-compatible agent through a module-owned adapter.
The adapter maps the ACP lifecycle onto existing daemon/session/channel
primitives instead of adding a second runtime or client protocol.

The first useful slice supports the core turn lifecycle:

- `initialize` with explicit KOTA capabilities and protocol version handling.
- `session/new` for a selected project root.
- `session/prompt` with streamed `session/update` events and a final stop
  reason.
- `session/cancel` and session cleanup using KOTA's existing abort/lifecycle
  behavior.
- Explicit protocol errors for unsupported ACP features rather than silent
  fallback.

## Constraints

- Keep this module-owned. Do not hardcode ACP routing into core beyond any
  genuinely reusable JSON-RPC or subprocess primitive.
- Keep the daemon as the source of truth for live sessions. The adapter should
  create, attach to, or route through daemon/session primitives rather than
  reading `.kota/` state directly.
- Treat ACP payloads as external input. Validate and normalize at the adapter
  boundary, then fail loudly on malformed internal protocol data.
- For stdio transport, stdout must contain only valid ACP JSON-RPC messages;
  logs and diagnostics belong on stderr or KOTA operator logs.
- ACP mode changes and tool-call approvals must map to KOTA's explicit
  autonomy/approval controls or be rejected as unsupported. Do not let an ACP
  client bypass configured guardrails.
- Keep optional ACP features scoped. MCP handoff, filesystem proxying, session
  lists, auth, terminal requests, and future Streamable HTTP support should be
  explicit capability decisions, not hidden partial implementations.

## Done When

- A module-owned ACP adapter is registered in the repo and has local
  `AGENTS.md` guidance covering its protocol boundary.
- There is an executable entry point suitable for ACP clients to launch over
  stdio.
- Focused tests cover successful `initialize`, `session/new`,
  `session/prompt`, streamed updates, cancellation, malformed JSON-RPC, protocol
  mismatch, and stdout/stderr separation.
- The adapter's capability response honestly advertises only the ACP features
  KOTA supports.
- Unsupported ACP requests produce typed protocol errors with no session side
  effects.
- The implementation does not add a parallel session store, task queue,
  approval path, or workflow trigger path.

## Source / Intent

Explorer run `2026-05-27T03-36-08-472Z-explorer-8s70vy` found ACP as a
nonduplicative interoperability signal while the ready queue was empty and all
strategic blocked alternatives required operator-captured artifacts.

Primary sources:

- https://agentclientprotocol.com/get-started/architecture - ACP architecture:
  JSON-RPC, stdio subprocess setup, concurrent sessions, bidirectional
  permission requests, and MCP handoff.
- https://agentclientprotocol.com/get-started/agents - registry signal listing
  many peer coding agents and adapters.
- https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md -
  Gemini CLI's ACP mode for programmatic IDE/tool control over stdio.
- https://zed.dev/blog/bring-your-own-agent-to-zed - Zed's rationale for using
  ACP to separate editor UI from agent implementations.
- https://acpx.sh/ - headless ACP client signal with structured events instead
  of PTY scraping.

## Initiative

Agent/client interoperability through module-owned channels.

## Acceptance Evidence

- Test command covering the ACP module tests.
- A protocol transcript or probe artifact under `.kota/runs/<run-id>/` showing
  a JSON-RPC ACP client initializing, creating a session, sending a prompt,
  receiving structured updates, and cancelling or closing cleanly.

## Completion Evidence

- `pnpm test src/modules/agent-client-protocol/index.test.ts`
- `pnpm run typecheck`
- `pnpm exec biome check src/modules/agent-client-protocol`
- `pnpm build`
- `.kota/runs/2026-05-27T03-41-39-611Z-builder-84l0x4/acp-protocol-transcript.jsonl`
