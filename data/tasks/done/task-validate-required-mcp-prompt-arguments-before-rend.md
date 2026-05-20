---
id: task-validate-required-mcp-prompt-arguments-before-rend
title: Validate required MCP prompt arguments before rendering
status: done
priority: p2
area: modules
summary: Align the MCP server prompts/get handler with the draft prompts spec by rejecting missing required prompt arguments instead of rendering placeholders or unresolved template variables.
created_at: 2026-05-20T11:48:21.242Z
updated_at: 2026-05-20T12:18:27.000Z
---

## Problem

KOTA's MCP server advertises required prompt arguments in `prompts/list`, but
`prompts/get` currently renders incomplete requests instead of rejecting them:

- built-in prompts use placeholder values such as `<task title>` or
  `<workflow-name>` when required arguments are absent;
- project prompt templates mark discovered variables as `required: true`, but
  rendering with missing variables returns a user message containing unresolved
  `{{variable}}` text plus an "Unresolved template variables" note.

The current MCP draft Prompts page treats missing required arguments as an
invalid-params error and explicitly calls out prompt argument validation as an
implementation requirement. KOTA already covers prompt listing, pagination,
project template exposure, completion for selected prompt arguments, and prompt
list change notifications; this remaining gap is the boundary where the server
should fail loudly instead of sending a malformed or placeholder prompt to a
client.

## Desired Outcome

`prompts/get` validates required arguments before rendering any built-in or
project prompt:

- every prompt definition has one source of truth for its required arguments;
- requests missing required arguments fail with JSON-RPC `-32602` and a clear
  message naming the missing argument(s);
- valid requests continue to render the same MCP `messages` shape as today;
- project prompt templates no longer return unresolved template variables in a
  successful MCP prompt response.

## Constraints

- Keep the work inside the `mcp-server` module and its existing
  prompt-handler/prompt-catalog split.
- Do not add a second prompt template DSL or a parallel MCP prompt registry.
- Preserve existing `prompts/list` pagination, prompt-list notifications, and
  completion behavior.
- Treat prompt arguments as external MCP input: validate once at the handler or
  catalog boundary, then expose explicit typed results to rendering code.

## Done When

- `prompts/get` rejects a built-in prompt request that omits a required
  argument, with `-32602` and a useful missing-argument message.
- `prompts/get` rejects a project prompt template request that omits one or
  more required template variables, with `-32602` and the missing variable
  names.
- Existing successful prompt rendering paths still pass for built-in and
  project prompts.
- Tests cover both missing-argument rejection paths and show that
  `prompts/list` still advertises the same required argument metadata.

## Source / Intent

Explorer run `2026-05-20T11-46-02-089Z-explorer-ugv2er` reviewed the
never-seen watchlist entry
`https://modelcontextprotocol.io/specification/draft/server/prompts`.

The official MCP draft Prompts page documents that prompt definitions can mark
arguments as required, `prompts/get` accepts those arguments, and missing
required arguments should be returned as JSON-RPC invalid params. The same page
also calls out prompt input/output validation as a security requirement.

Local evidence:

- `src/modules/mcp-server/prompts.ts` marks built-in and project template
  arguments as required.
- `renderCreateTask`, `renderTriggerWorkflow`, and `renderSummarizeRun` fall
  back to placeholder values when required inputs are absent.
- Project template rendering appends an unresolved-variable note to a
  successful prompt response.
- `src/modules/mcp-server/server.test.ts` currently asserts the unresolved
  project-template behavior.

Completed tasks already cover the surrounding MCP prompt surface
(`task-mcp-server-prompts`,
`task-expose-project-prompt-templates-through-mcp-prompt`, and
`task-mcp-completions-support`), so this task is only the missing required
argument validation slice.

## Initiative

MCP protocol fidelity: KOTA should expose module-owned prompts over MCP through
strict, predictable protocol boundaries instead of allowing incomplete external
requests to become agent-facing prompt text.

## Acceptance Evidence

- Focused MCP server tests pass, for example:
  `pnpm test src/modules/mcp-server/server.test.ts`.
- The test output demonstrates missing required built-in and project prompt
  arguments are rejected with `-32602`, while valid `prompts/get` requests still
  render valid MCP prompt messages.
