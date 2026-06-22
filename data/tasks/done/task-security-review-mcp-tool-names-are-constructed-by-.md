---
id: task-security-review-mcp-tool-names-are-constructed-by-
title: Security review: MCP tool names are constructed by raw concatenation with the same "__" delimiter that tool names may contain, while replaceServerTools silently writes generated names into a single toolMap. Colliding pairs such as server "a"/tool "b__c" and server "a__b"/tool "c" collapse to mcp__a__b__c, so a configured remote server can shadow another remote tool and route an intended call to the wrong server.
status: done
priority: p2
area: security
summary: MCP tool names are constructed by raw concatenation with the same "__" delimiter that tool names may contain, while replaceServerTools silently writes generated names into a single toolMap. Colliding pairs such as server "a"/tool "b__c" and server "a__b"/tool "c" collapse to mcp__a__b__c, so a configured remote server can shadow another remote tool and route an intended call to the wrong server.
created_at: 2026-06-22T16:47:12.464Z
updated_at: 2026-06-22T17:59:00.000Z
---

## Problem

The security-review workflow confirmed an application-security finding.

severity: medium
affected path: src/core/mcp/manager.ts
claim:

> MCP tool names are constructed by raw concatenation with the same "__" delimiter that tool names may contain, while replaceServerTools silently writes generated names into a single toolMap. Colliding pairs such as server "a"/tool "b__c" and server "a__b"/tool "c" collapse to mcp__a__b__c, so a configured remote server can shadow another remote tool and route an intended call to the wrong server.

## Desired Outcome

> Make MCP namespacing injective: reject or escape separator-bearing server config names and remote tool names, and fail initialization or refresh on duplicate generated tool names rather than silently overwriting toolMap entries.

## Constraints

- Preserve the confirmed security claim and cited evidence until the fix lands.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.

## Done When

- The cited vulnerability is fixed or proven impossible with code-level evidence.
- Focused regression coverage guards the fixed boundary.
- The task records the final verification command or artifact.

## Source / Intent

Created by security-review workflow run 2026-06-22T16-27-44-599Z-security-review-jhfyyc.

finding id: mcp-tool-name-collision-shadowing
candidate id: mcp-transport:src/core/mcp/manager.ts:309
verdict: confirmed
rationale:

> Current source still builds MCP tool names by raw concatenation in namespaceTool using the shared '__' separator, parseToolName treats later separator-delimited parts as tool name, manager initialization does not validate config object keys, tool names are only decoded as strings, and replaceServerTools inserts generated names into a single Map with set(). Colliding generated names therefore remain last-writer-wins and can route a namespaced tool call to the wrong current entry.

Evidence:

Evidence 1:



path: src/core/mcp/manager.ts

line: 307

excerpt:



> /** Build a namespaced tool name: mcp__<server>__<tool> */

Evidence 2:



path: src/core/mcp/manager.ts

line: 309

excerpt:



> return `mcp${SEPARATOR}${serverName}${SEPARATOR}${toolName}`;

Evidence 3:



path: src/core/mcp/manager.ts

line: 331

excerpt:



> const parts = name.split(SEPARATOR);

Evidence 4:



path: src/core/mcp/manager.ts

line: 333

excerpt:



> return { server: parts[1], tool: parts.slice(2).join(SEPARATOR) };

Evidence 5:



path: src/core/mcp/manager.ts

line: 2528

excerpt:



> nextToolMap.set(entry.tool.name, entry);

## Initiative

Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.
- Verification in `.kota/runs/2026-06-22T16-40-20-566Z-builder-z23g4f/validation.txt` records focused regression tests, typecheck, lint, staged source-size review, and task validation passing.

## Source Size Exception

kind: source-size-cleanup
files:
- src/core/mcp/manager.ts
