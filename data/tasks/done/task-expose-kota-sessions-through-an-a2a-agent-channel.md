---
id: task-expose-kota-sessions-through-an-a2a-agent-channel
title: Expose KOTA sessions through an A2A agent channel
status: done
priority: p2
area: modules
summary: Add a module-owned Agent2Agent channel that exposes KOTA daemon sessions through A2A Agent Card discovery, task lifecycle methods, and streaming updates without adding a parallel runtime.
created_at: 2026-05-27T05:41:52.043Z
updated_at: 2026-05-27T06:23:05.000Z
---

## Problem

KOTA now has a module-owned ACP adapter for editor/headless client control and
deep MCP client/server coverage for tools, resources, prompts, tasks, skills,
authorization, and registry metadata. It does not have an Agent2Agent (A2A)
surface.

A2A is a distinct interoperability layer from MCP: MCP standardizes how an
agent uses tools and resources, while A2A standardizes how opaque agents
discover each other, exchange messages, and collaborate on stateful tasks. A
remote agent that wants to delegate a long-running task to KOTA currently has
to use a bespoke KOTA client, misuse MCP as a task channel, or shell out
through ACP. None of those expose KOTA as an agent peer with a discoverable
Agent Card, task lifecycle, streaming updates, and explicit capability/security
metadata.

## Desired Outcome

KOTA exposes daemon-owned sessions through a module-owned A2A channel. The
module maps the A2A task lifecycle onto existing daemon/session/channel
primitives instead of adding a second runtime, task store, approval path, or
workflow engine.

The first useful slice supports:

- A public Agent Card route at the A2A well-known path, plus any authenticated
  extended-card route the implementation needs for sensitive details.
- A JSON-RPC-over-HTTP endpoint that handles `SendMessage`,
  `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, and
  `SubscribeToTask` for KOTA-backed sessions/tasks.
- SSE streaming that maps daemon session output into A2A task status/artifact
  updates without exposing internal reasoning traces, private tool state, or
  raw `.kota/` files.
- Honest capability advertising for streaming, push notifications, extended
  Agent Cards, input/output modes, and supported skills.
- Typed errors for malformed requests, unsupported A2A methods, unauthorized
  access, unknown task ids, terminal-task subscription attempts, and capability
  mismatches.

## Constraints

- Keep the integration module-owned, likely under `src/modules/a2a-channel/` or
  a similarly explicit module name. Core should only gain reusable route or
  session helpers if the channel cannot use the existing daemon control/session
  surface cleanly.
- Treat all A2A HTTP bodies, headers, Agent Card inputs, and resumed task ids as
  external data. Decode once at the module boundary and pass typed internal
  values onward.
- Do not expose internal agent state, memory, tools, system prompts, workflow
  run internals, or thinking traces through A2A. A2A clients see declared
  skills, messages, task status, and sanitized artifacts.
- Reuse KOTA's configured auth, project scoping, autonomy mode, and approval
  guardrails. An A2A caller must not bypass daemon auth or approval policy by
  entering through a new protocol route.
- Do not implement push notifications unless the route includes real callback
  authentication, persistence, and unsubscribe behavior. Advertising
  `pushNotifications: false` is acceptable for the first slice.
- Keep MCP separate. A2A may advertise KOTA's agent skills and may mention MCP
  complementarity, but it should not re-export every MCP tool as a long-running
  agent skill by default.
- Add local `AGENTS.md` guidance for the A2A module covering protocol stdout/
  HTTP boundaries, Agent Card sensitivity, and capability-advertising rules.

## Done When

- A module-owned A2A channel is registered in KOTA and contributes its HTTP
  routes through the module system.
- `/.well-known/agent-card.json` returns a valid KOTA Agent Card with stable
  identity, supported interface metadata, version, capability flags, security
  metadata, input/output modes, and a small set of KOTA agent skills.
- The JSON-RPC endpoint supports `SendMessage`, `SendStreamingMessage`,
  `GetTask`, `ListTasks`, `CancelTask`, and `SubscribeToTask` against
  daemon-owned sessions/tasks, with no parallel task store.
- Unsupported methods, malformed payloads, unsupported content parts, unknown
  tasks, unauthorized calls, and terminal-task subscriptions return typed A2A /
  JSON-RPC errors with no side effects.
- Streaming responses use SSE and include enough task status/artifact updates
  for an A2A client to observe a full turn from working to terminal state.
- Focused tests cover Agent Card generation and caching headers, JSON-RPC
  success paths, streaming, cancellation, list/get filtering by project or
  context, auth failure, bad params, unsupported method, and guardrail/approval
  propagation.
- The implementation does not add a new public task queue, workflow engine,
  session store, agent registry, or MCP mirror.

## Source / Intent

Explorer run `2026-05-27T05-39-59-854Z-explorer-t5z7kq` found the actionable
queue empty: zero ready tasks, zero doing tasks, and two backlog tasks waiting
on `task-enable-autonomous-access-to-auth-walled-sources-so`. The strategic
blocked alternatives all require operator-captured artifacts and are not
movable, so opening one protocol-interoperability slice is preferable to a
noop or client fan-out work.

Primary sources:

- https://a2a-protocol.org/latest/ - official A2A docs describe Agent2Agent as
  an open standard for collaboration between remote, local, and human-facing
  agents, donated by Google to the Linux Foundation.
- https://a2a-protocol.org/latest/specification/ - A2A v1.0 defines Agent
  Cards, messages, stateful tasks, artifacts, JSON-RPC over HTTP(S), SSE
  streaming, push notifications, security schemes, and Agent Card signatures.
- https://a2a-protocol.org/latest/topics/agent-discovery/ - discovery uses
  `/.well-known/agent-card.json`, direct configuration, or registries; cards
  include identity, endpoint, capabilities, authentication, and skills.
- https://a2a-protocol.org/latest/topics/a2a-and-mcp/ - A2A and MCP are
  complementary, with MCP for agent-to-tool/resource access and A2A for
  agent-to-agent collaboration.
- https://github.com/a2aproject/A2A - the Linux Foundation A2A project repo
  links official SDKs and records v1.0.0 as the current release line.

## Initiative

Protocol interoperability through module-owned channels.

## Acceptance Evidence

- `pnpm test src/modules/a2a-channel src/core/daemon/daemon-chat-handlers.test.ts` passed.
- `pnpm run typecheck` passed.
- `pnpm exec biome check src/modules/a2a-channel src/core/daemon/daemon-chat-handlers.ts src/core/daemon/daemon-chat-pool.ts src/core/daemon/daemon-control-routes.ts src/core/daemon/daemon-chat-handlers.test.ts` passed.
- `pnpm test src/task-files.test.ts` passed.
- Protocol transcript:
  `.kota/runs/2026-05-27T05-44-30-913Z-builder-inleza/protocol-transcript.txt`
  shows Agent Card fetch, `SendMessage`, `SendStreamingMessage`, `GetTask`,
  `ListTasks`, `CancelTask`, `SubscribeToTask`, and typed error responses
  against test daemon sessions, including an active `SubscribeToTask` stream
  bridged from daemon session output.
