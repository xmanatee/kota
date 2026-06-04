---
id: task-security-review-the-daemon-session-creation-path-a
title: Security review: The daemon session creation path accepts caller-supplied stdio MCP server configs and passes their command, args, and env into AgentSession. When MCP initializes, KOTA spawns that command outside the normal tool approval path, so a bearer-control client can turn session creation/chat into local process execution by embedding an MCP server command.
status: ready
priority: p2
area: security
summary: The daemon session creation path accepts caller-supplied stdio MCP server configs and passes their command, args, and env into AgentSession. When MCP initializes, KOTA spawns that command outside the normal tool approval path, so a bearer-control client can turn session creation/chat into local process execution by embedding an MCP server command.
created_at: 2026-06-04T01:24:52.055Z
updated_at: 2026-06-04T01:24:52.055Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/daemon/daemon-chat-handlers.ts
claim: The daemon session creation path accepts caller-supplied stdio MCP server configs and passes their command, args, and env into AgentSession. When MCP initializes, KOTA spawns that command outside the normal tool approval path, so a bearer-control client can turn session creation/chat into local process execution by embedding an MCP server command.

## Desired Outcome

Do not accept arbitrary stdio MCP configs on the daemon-control session API. Restrict session MCP handoff to project-configured or allowlisted servers, or require a separate explicit authorization before spawning client-supplied stdio commands.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-04T01-16-01-379Z-security-review-psbw1u.

finding id: daemon-session-client-supplied-stdio-mcp-command
candidate id: daemon-control-route:src/core/daemon/daemon-chat-handlers.ts:30
verdict: confirmed
rationale: POST /sessions is a bearer-token control route that decodes request body mcp_servers, accepts stdio command/args/env without an allowlist, passes them into AgentSession, and AgentSession starts MCP initialization on creation. McpManager connects configured servers and connectStdio spawns the supplied command directly, so a control client can cause local process execution outside the normal tool-approval path.

Evidence:

- src/core/daemon/daemon-control-routes.ts:413 - method: "POST",
- src/core/daemon/daemon-control-routes.ts:415 - capabilityScope: "control",
- src/core/daemon/daemon-chat-handlers.ts:134 - mcpServers = decodeDaemonMcpServers(body.mcp_servers);
- src/core/daemon/daemon-chat-handlers.ts:557 - command: requiredString(value.command, `mcp_servers.${name}.command`),
- src/core/daemon/daemon-init.ts:248 - mcpServers,
- src/core/mcp/client-connection.ts:73 - this.proc = spawn(this.transport.command, this.transport.args ?? [], {

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
