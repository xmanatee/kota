---
id: task-bridge-acp-client-permission-decisions-into-daemon
title: Bridge ACP client permission decisions into daemon session approval
status: done
priority: p2
area: modules
summary: Route ACP session/request_permission through KOTA's existing tool approval and autonomy-mode path so ACP prompt turns can ask the connected client for write/execute permission instead of stalling behind an out-of-band KOTA approval queue.
created_at: 2026-05-28T04:36:14.992Z
updated_at: 2026-05-28T14:07:18Z
---

## Problem

KOTA's Agent Client Protocol adapter can create, resume, prompt, list, cancel,
and close daemon-backed sessions, and it now accepts ACP client-supplied MCP
servers. The prompt path still treats ACP as a one-way text stream: daemon SSE
events are mapped to `agent_message_chunk` / `agent_thought_chunk`, incoming
JSON-RPC responses from the ACP peer are ignored, and there is no outgoing
ACP request path for `session/request_permission`.

That leaves supervised ACP sessions with a poor permission boundary. When a
tool call requires write/execute approval, KOTA can only rely on its normal
out-of-band approval queue or harness-specific internal policy behavior. An
editor that connected through ACP cannot answer the permission request through
the ACP session it owns, so a prompt can stall behind an approval surface the
ACP user never sees.

This is not a request to add a second approval engine. KOTA already has
guardrails, autonomy modes, and approval state. The gap is the ACP transport
bridge: the connected ACP client needs to receive a typed permission request,
return allow/deny, and have that decision flow back into the same daemon
session turn.

## Desired Outcome

ACP prompt turns can round-trip tool permission decisions through the connected
ACP client using the protocol's `session/request_permission` shape, while KOTA
keeps its existing internal approval and guardrail semantics.

Concretely:

- The ACP server can issue a JSON-RPC request to the peer during
  `session/prompt`, correlate the peer response, and continue or fail the
  daemon turn deterministically.
- Daemon session tool-approval requests that are safe to delegate to the ACP
  client are projected as ACP permission requests with redacted, typed tool
  call context.
- ACP allow/deny responses are normalized once at the module boundary and fed
  into the existing KOTA permission/approval path; unsupported or malformed
  responses fail loudly.
- Cancellation closes the loop: `session/cancel`, prompt aborts, ACP client
  disconnects, and permission-response timeouts all unblock the daemon turn
  without leaving a live prompt or pending approval orphaned.
- Protocol output remains clean JSON-RPC on stdout; diagnostics and redacted
  failures stay on stderr or in run artifacts.

## Constraints

- Keep ACP protocol decoding, outgoing request correlation, and capability
  decisions inside `src/modules/agent-client-protocol/`.
- Reuse KOTA's existing autonomy-mode, guardrail, and approval primitives.
  Do not add an ACP-only approval queue, tool registry, or parallel session
  store.
- Preserve the current safe default for non-ACP channels. The bridge activates
  only for daemon sessions owned by an ACP connection that can receive and
  answer the request.
- Treat every ACP permission response as external input. Decode once, reject
  unknown decision shapes, and do not silently coerce missing fields into allow.
- Redact tool input fields that may contain secrets in ACP permission request
  logs, transcripts, errors, and tests. The client may receive the minimum
  tool context required to decide; artifacts must not leak raw secrets.
- Do not broaden ACP prompt content support in this task. Image/audio/resource
  expansion and `session/load` stay out of scope.
- Do not implement a new public permission-profile DSL. If an internal seam
  is needed between daemon sessions and the ACP module, keep it typed and
  protocol-neutral enough for future channels to reuse.

## Done When

- `AgentClientProtocolServer` has a typed outgoing JSON-RPC request path for
  peer calls during an active prompt and no longer ignores matching peer
  responses blindly.
- ACP `session/request_permission` requests are emitted from ACP-owned daemon
  session turns when a write/execute tool call requires client approval.
- ACP permission allow/deny responses route back into the active daemon turn
  and produce the same observable tool-approval behavior KOTA would produce
  through its normal approval boundary.
- Prompt cancellation, client disconnect, malformed permission responses, and
  permission timeout all unblock the active turn with a typed ACP/KOTA error
  and leave no dangling `activePrompts` entry or pending approval item.
- `initialize` advertises only capabilities this adapter actually supports
  after the bridge lands.
- Focused tests cover: outgoing request id correlation, successful allow,
  explicit deny, malformed response rejection, cancellation while waiting for
  permission, client disconnect while waiting, stdout JSON-RPC purity, and
  secret redaction in permission request artifacts/errors.

## Source / Intent

Explorer run `2026-05-28T04-33-15-824Z-explorer-m2kpzn` found no actionable
work (`ready=0`, `doing=0`) and only two backlog tasks blocked on
`task-enable-autonomous-access-to-auth-walled-sources-so`. The strategic
blocked alternatives surfaced by `inspect-queue` are all operator-capture
waits and not movable:

- `task-add-a-black-box-behavior-reconstruction-fixture-to`
- `task-add-a-scientific-claim-reproduction-fixture-to-the`
- `task-add-a-scorable-empirical-code-optimization-fixture`
- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The Gemini CLI watchlist entry was refreshed because it had a recent
autonomy-protocol signal. Its `v0.45.0-nightly.20260527` release notes include
`fix(cli): integrate PolicyEngine into ACP session to prevent deadlocks`, which
is the exact failure class this task targets for KOTA's ACP adapter:
https://github.com/google-gemini/gemini-cli/releases

Primary ACP protocol source: the ACP Tool Calls documentation defines
`session/request_permission` as the agent-to-client permission path for tool
calls:
https://agentclientprotocol.com/protocol/tool-calls

Local overlap check:

- `task-connect-acp-client-supplied-mcp-servers-to-daemon-` completed
  ACP stdio MCP handoff, session resume, and unsupported transport behavior,
  but did not add permission round trips.
- `src/modules/agent-client-protocol/server.ts` treats incoming JSON-RPC peer
  responses as no-ops and has no outgoing request correlation path.
- `src/modules/agent-client-protocol/daemon-adapter.ts` maps daemon SSE
  `text`, `thinking`, `progress`, `status`, `error`, and `done` events to ACP
  updates/results, but has no permission-request event mapping.
- `src/modules/agent-client-protocol/protocol.ts` defines `agent_message_chunk`
  and `agent_thought_chunk` helpers, but no ACP permission request/response
  decoder.

## Initiative

Agent/client interoperability through module-owned protocol adapters.

## Acceptance Evidence

- `pnpm test src/modules/agent-client-protocol/index.test.ts`
- `pnpm run typecheck`
- `pnpm exec biome check src/modules/agent-client-protocol src/core/daemon src/core/agent-harness`
- Protocol transcript under `.kota/runs/<run-id>/` showing `initialize`,
  `session/new`, `session/prompt`, an outgoing `session/request_permission`
  request, an allow response that lets the tool call proceed, a deny response
  that blocks a tool call, and a cancellation while a permission request is
  pending. The transcript must show stdout remains JSON-RPC only and must not
  contain raw secret values from tool inputs.
