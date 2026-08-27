---
status: done
---

# Add MCP prompts capability to the KOTA MCP server

## Problem

`src/mcp/server.ts` declares `capabilities: { tools: {}, resources: {} }` but omits `prompts`. MCP hosts that support prompts (Claude Code, Cursor, etc.) cannot surface KOTA-specific prompt templates from the server. Operators who want to interact with KOTA via an MCP host have to compose prompts manually each time — there is no quick-pick for common actions like "create a task" or "trigger a workflow".

## Desired Outcome

The KOTA MCP server exposes a curated set of prompt templates via the `prompts/list` and `prompts/get` handlers:

- `kota-create-task` — template for drafting a new task in the correct frontmatter format.
- `kota-trigger-workflow` — template with a workflow name placeholder and optional payload.
- `kota-summarize-run` — template that accepts a run ID and asks for a plain-language summary.

The server's `capabilities` response includes `prompts: {}`. Hosts that don't support prompts are unaffected.

## Constraints

- No new npm dependencies.
- Prompt definitions are static; no dynamic generation from runtime state.
- Follow the MCP prompts spec: `prompts/list` returns name+description+argument list; `prompts/get` returns the rendered message array.
- Keep all prompt logic in `src/mcp/` — do not reach into workflow or scheduler internals.

## Done When

- `capabilities` includes `prompts: {}`.
- `prompts/list` returns at least the three prompt templates above.
- `prompts/get` returns a valid rendered messages array for each template.
- Existing MCP server tests pass; new tests cover `prompts/list` and `prompts/get`.
