---
id: task-security-review-mcp-peer-controlled-error-text-rea
title: Security review: MCP peer-controlled error text reaches operator stderr without terminal-control sanitization, allowing a malicious MCP server to spoof output or invoke terminal features through OSC, CSI, C1, or bidirectional controls.
status: ready
priority: p2
area: security
task_class: Safety
summary: MCP peer-controlled error text reaches operator stderr without terminal-control sanitization, allowing a malicious MCP server to spoof output or invoke terminal features through OSC, CSI, C1, or bidirectional controls.
created_at: 2026-08-01T09:30:09.279Z
updated_at: 2026-08-01T09:30:09.279Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/client-auth-types.ts
claim:

> MCP peer-controlled error text reaches operator stderr without terminal-control sanitization, allowing a malicious MCP server to spoof output or invoke terminal features through OSC, CSI, C1, or bidirectional controls.

## Desired Outcome

> Sanitize diagnostic message and detail text at the centralized terminal-diagnostic boundary, including its no-provider fallback, before rendering or raw stderr writes. Add an MCP fixture covering OSC, CSI/C1, and bidi controls in JSON-RPC errors and remote server names.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-08-01T09-09-41-035Z-security-review-pxj6wc.

finding id: mcp-terminal-diagnostic-control-injection
candidate id: mcp-transport:src/core/mcp/client-auth-types.ts:226
verdict: confirmed
rationale:

> Peer-supplied JSON-RPC error.message is interpolated at client-http-runtime.ts:206-210, wrapped without control sanitization by client-base.ts:427-440 and client-auth-types.ts:221-227, then forwarded to printTerminalDiagnostic at manager.ts:657-661. rendering-provider.ts:102-110 places the message in a span, while render-paint.ts:31-37 emits span.text unchanged; terminal-renderer.ts:40-44 also writes it raw when no provider exists. A runtime rendering probe preserved OSC, CSI, and bidi controls. The configured server name is not peer-controlled, but the remote error message alone establishes the violation.

Evidence:

Evidence 1:



path: src/core/mcp/client-http-runtime.ts

line: 209

excerpt:



> `HTTP ${response.status}: MCP error ${message.error.code}: ${message.error.message}`

Evidence 2:



path: src/core/mcp/client-auth-types.ts

line: 226

excerpt:



> super(`MCP connection error for server "${serverName}" during ${method}: ${message}`);

Evidence 3:



path: src/core/mcp/manager.ts

line: 659

excerpt:



> `[kota] MCP server "${name}" failed to connect: ${(err as Error).message}`

Evidence 4:



path: src/modules/rendering/rendering-provider.ts

line: 107

excerpt:



> line(span(diagnostic.message, role)),

Evidence 5:



path: src/modules/rendering/render-paint.ts

line: 37

excerpt:



> return `${opens}${span.text}\x1b[0m`;

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
