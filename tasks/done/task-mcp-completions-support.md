---
id: task-mcp-completions-support
title: Implement MCP completion/complete for argument autocomplete
status: done
priority: p3
area: mcp
summary: The MCP protocol supports a completion/complete request that lets hosts autocomplete argument values in tool and prompt calls; implementing it in KOTA's MCP server enables workflow names, task IDs, and agent names to autocomplete in Claude Code and Cursor.
created_at: 2026-04-02T11:35:00Z
updated_at: 2026-04-02T13:55:00Z
---

## Problem

KOTA's MCP server exposes tools and prompts with string arguments (e.g., `workflow` in `kota-trigger-workflow`, `run_id` in `kota-summarize-run`). When a user types a partial workflow name in Claude Code or Cursor, there is no autocomplete feedback because the server does not implement `completion/complete`. Users must remember exact names.

## Desired Outcome

`McpServer` handles `completion/complete` requests for:
- Prompt argument `workflow` in `kota-trigger-workflow`: returns matching workflow names from the loaded definitions.
- Prompt argument `run_id` in `kota-summarize-run`: returns recent run IDs from the run store (last 20).
- Tool argument completion for tools that accept an `agentName` or `workflowName` parameter: returns registered agent or workflow names.

Completions are returned as a `{ completion: { values: string[], hasMore: boolean } }` response per the MCP spec. The server advertises `completions: {}` in its capabilities when completions are supported.

## Constraints

- Only implement completions for the prompt and tool arguments where a finite enumerable set of valid values exists at request time. Do not add completions for free-text arguments.
- The completions handler should be read-only and stateless; it must not trigger workflow runs or write to disk.
- If the run store is unavailable, run_id completions return an empty list gracefully.
- Follow the MCP 2025-03-26 spec for the `completion/complete` message shape.

## Done When

- `McpServer` handles `completion/complete` without throwing for supported arguments.
- `kota-trigger-workflow` `workflow` argument autocompletes in a compatible host (Claude Code or Cursor verified manually or via test).
- `docs/MCP.md` lists completions support under the Capabilities section.
- Unit test covers the completions handler for workflow name completion.
