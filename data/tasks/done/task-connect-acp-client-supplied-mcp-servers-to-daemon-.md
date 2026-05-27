---
id: task-connect-acp-client-supplied-mcp-servers-to-daemon-
title: Connect ACP client-supplied MCP servers to daemon sessions
status: done
priority: p2
area: modules
summary: Accept ACP client-provided MCP server configs for session/new and session/resume, route them through KOTA's existing session/harness MCP server path, and keep capability advertising and unsupported transports honest.
created_at: 2026-05-27T09:22:43.938Z
updated_at: 2026-05-27T09:47:44.000Z
---

## Problem

KOTA's ACP adapter now supports daemon-backed session creation, prompting,
session listing, and resume. It still rejects every non-empty
`mcpServers` list during `session/new` and `session/resume`, even though ACP
session setup treats client-provided MCP servers as the way an editor gives an
agent access to user-configured MCP tools and data.

That leaves ACP clients in an awkward state: they can run KOTA as an agent, but
cannot pass through the same MCP servers the editor has already configured.
KOTA already has a neutral `mcpServers` run option and external MCP client
runtime, so this should be a module adapter integration, not a second tool
registry or a bespoke ACP-side MCP stack.

## Desired Outcome

ACP `session/new` and `session/resume` accept supported client-provided MCP
server configs, normalize them at the ACP boundary, and attach them to the
daemon-owned session so subsequent prompts run with those MCP servers available
through KOTA's existing session/harness path.

Capability advertising stays honest: stdio MCP handoff works because ACP
requires it, while HTTP remains advertised only if the KOTA path actually
supports ACP-provided HTTP MCP configs end-to-end. SSE stays unsupported unless
the implementation deliberately opts into the deprecated transport with tests.

## Constraints

- Keep ACP decoding, capability decisions, and JSON-RPC errors in
  `src/modules/agent-client-protocol/`.
- Reuse KOTA's existing `AgentHarnessRunOptions.mcpServers` /
  external-MCP runtime path. Do not add an ACP-owned MCP process registry,
  tool registry, session store, or daemon side channel.
- Decode every ACP MCP server object strictly at the external boundary.
  Malformed names, commands, args, env entries, URLs, headers, duplicate
  names, unsupported transports, and relative stdio commands must fail loudly
  before daemon session creation or resume side effects.
- Preserve harness capability boundaries. If the active session harness cannot
  honor non-empty `mcpServers`, surface the existing loud unsupported-option
  error instead of silently dropping the client-provided servers.
- Treat ACP-provided env values and HTTP headers as secrets in logs,
  transcripts, errors, and run artifacts.
- Do not implement `session/load` or history replay as part of this task.

## Done When

- `session/new` accepts at least one valid ACP stdio MCP server config, stores
  the normalized server set with the ACP-bound daemon session, and prompts use
  that set through KOTA's existing harness/session execution path.
- `session/resume` accepts MCP server configs, reattaches them to the resumed
  daemon session without replaying history, and rejects attempts that would
  conflict with an already-active ACP connection.
- `initialize` advertises ACP MCP transport capabilities that match the
  implemented behavior; unsupported HTTP/SSE handoff remains disabled or
  returns typed unsupported-feature errors with no side effects.
- Focused ACP tests cover successful stdio handoff, resume handoff, malformed
  server entries, duplicate server names, secret redaction, unsupported
  transports, and harness rejection when the selected harness cannot honor
  non-empty `mcpServers`.
- Existing cross-harness `mcpServers` parity tests remain green.

## Source / Intent

Explorer run `2026-05-27T09-19-57-836Z-explorer-zwx8f9` reviewed a zero
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and are not movable, so a focused ACP
interoperability slice is preferable to surface fan-out work or another
blocked eval fixture.

Primary ACP sources checked:

- `https://agentclientprotocol.com/get-started/architecture` says editors pass
  user-configured MCP server configuration to agents rather than running MCP
  and ACP on the same socket.
- `https://agentclientprotocol.com/protocol/session-setup` defines
  `mcpServers` on `session/new`, `session/load`, and `session/resume`; stdio is
  required for agents, HTTP is optional behind `mcpCapabilities.http`, and SSE
  is explicitly deprecated.

Local overlap check:

- `task-add-acp-session-discovery-and-resume-support` completed session
  listing and resume but intentionally kept non-empty `mcpServers` rejected.
- `task-add-cross-harness-mcpservers-parity-integration-te` already locks the
  neutral harness boundary: Claude forwards `mcpServers`; OpenAI Tools and
  thin reject loudly.
- `src/modules/agent-client-protocol/protocol.ts` currently rejects non-empty
  `mcpServers` in `session/new` and `session/resume` before daemon work starts.

## Initiative

Agent/client interoperability through module-owned protocol adapters.

## Acceptance Evidence

- `pnpm test src/modules/agent-client-protocol/index.test.ts`
- Cross-harness MCP server parity remains green, for example
  `pnpm test src/mcp-servers-cross-harness.integration.test.ts`
- `pnpm run typecheck`
- `pnpm exec biome check src/modules/agent-client-protocol src/core/daemon src/core/agent-harness`
- Protocol transcript under `.kota/runs/<run-id>/` showing initialize,
  `session/new` with a redacted stdio MCP server config, a prompt that reaches
  the normalized `mcpServers` path, adapter restart, `session/resume` with the
  same MCP server config, and a follow-up prompt; the transcript must not leak
  env/header secret values.

## Outcome

ACP `session/new` and `session/resume` now normalize stdio MCP server configs,
attach them to daemon-owned sessions, and keep HTTP/SSE handoff unsupported in
the advertised capabilities. Evidence was captured in
`.kota/runs/2026-05-27T09-25-59-030Z-builder-u9kg4k/acp-mcp-transcript.md`.
