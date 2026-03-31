---
id: task-mcp-sampling-support
title: Add MCP sampling capability so clients can delegate LLM calls to KOTA
status: backlog
priority: p3
area: runtime
summary: KOTA's MCP server does not yet implement the sampling capability, which would allow external MCP clients to request LLM completions through KOTA's configured model provider. Adding sampling turns KOTA into a shared AI backend for tool-calling MCP clients.
created_at: 2026-03-31T14:10:00Z
updated_at: 2026-03-31T14:10:00Z
---

## Problem

The MCP spec includes a `sampling/createMessage` request that lets a client ask the server (KOTA) to perform an LLM completion on its behalf. KOTA's MCP server currently advertises `tools`, `resources`, and `prompts` capabilities but not `sampling`. External agents or IDE extensions that connect as MCP clients cannot delegate inference to KOTA's configured model, so each client must maintain its own model credentials and connection.

## Desired Outcome

KOTA's MCP server advertises `sampling` in its capabilities and handles `sampling/createMessage` requests by routing them through the configured model provider (same client used for agent steps). The caller can specify messages, model preferences, and a max-token budget; KOTA returns the completion. Cost is tracked under a synthetic session so it appears in `kota workflow cost` output.

## Constraints

- Use the same `ModelClient` abstraction already used by `AgentSession`; do not bypass it.
- Respect the configured model and any cost limits already in place.
- Do not expose sampling unless explicitly enabled in config (`mcp.sampling.enabled: true`); default off to avoid unexpected spend.
- No new persistence; the completion is returned inline and cost logged to the run artifact store.

## Done When

- `kota mcp` server advertises `sampling` capability when `mcp.sampling.enabled` is true.
- `sampling/createMessage` requests complete and return a valid MCP `CreateMessageResult`.
- Cost is tracked and visible in `kota workflow cost`.
- Unit test covers the handler with a mock model client.
- `docs/MCP.md` documents the sampling capability and config flag.
