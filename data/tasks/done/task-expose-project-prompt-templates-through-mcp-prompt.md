---
id: task-expose-project-prompt-templates-through-mcp-prompt
title: Expose project prompt templates through MCP prompts
status: done
priority: p2
area: modules
summary: Adapt the MCP prompts surface to the existing .kota/prompts template store so MCP hosts see project prompt templates with draft prompt pagination, completion, and prompt-list change behavior instead of only a static MCP-only catalog.
created_at: 2026-05-20T09:59:15.550Z
updated_at: 2026-05-20T10:14:47.000Z
---

## Problem

KOTA's MCP prompts surface is currently a static MCP-only catalog:
`src/modules/mcp-server/prompts.ts` defines `KOTA_PROMPTS`, and
`prompts/list` returns that array directly. That duplicates an existing
runtime capability: the `prompt-templates` module already owns reusable
markdown prompt files in `.kota/prompts/`, with YAML front matter,
variable discovery, and rendering.

The current MCP draft prompts spec makes this duplication more visible:
`prompts/list` is paginated, prompt definitions can include display metadata,
`prompts/get` can participate in multi-round input, and servers that advertise
prompt list changes send `notifications/prompts/list_changed` through
`subscriptions/listen`. KOTA's draft discovery path still advertises
`prompts: {}` and its `subscriptions/listen` handler only acknowledges
resource notifications. A host connected over MCP therefore cannot discover
project prompt templates, cannot page a larger prompt catalog, and cannot
invalidate its prompt picker when `.kota/prompts/` changes.

This cuts against the local MCP-server contract: MCP is supposed to adapt KOTA
capabilities, not maintain a second capability registry.

## Desired Outcome

The MCP prompts surface is backed by KOTA's prompt-template capability instead
of a static MCP-only list. MCP hosts can discover and use project templates
from `.kota/prompts/` alongside the existing KOTA convenience prompts through
one typed prompt catalog.

The catalog follows the current draft prompt behavior where it matters for
KOTA:

- `prompts/list` is deterministic and cursor-paginated.
- `.kota/prompts/*.md` entries appear as MCP prompts with template variables
  exposed as prompt arguments.
- `prompts/get` renders project templates through the same substitution rules
  the `prompt_template` tool uses, with unresolved variables represented
  explicitly rather than silently dropped.
- `completion/complete` continues to serve the finite KOTA prompt argument
  spaces and is extended only where project templates have a real finite
  completion source.
- `subscriptions/listen` can acknowledge `promptsListChanged` and emit
  `notifications/prompts/list_changed` when the prompt catalog changes, or the
  server does not advertise prompt `listChanged`.

## Constraints

- Keep ownership inside `src/modules/mcp-server/` and
  `src/modules/prompt-templates/`. Do not move prompt-template storage into
  core.
- Do not add a third prompt registry. If built-in KOTA convenience prompts
  remain, expose them through the same catalog/provider boundary that project
  templates use.
- Treat `.kota/prompts/` files as external project data. Malformed prompt
  files should have an explicit boundary behavior that is covered by tests.
- Keep exact MCP wire names and payload fields in source types and focused
  tests, not durable docs.
- Preserve existing `prompts/list`, `prompts/get`, and
  `completion/complete` behavior for the three built-in KOTA prompts unless
  the replacement catalog deliberately supersedes them.

## Done When

- `prompts/list` returns built-in KOTA prompts and discovered
  `.kota/prompts/` templates in deterministic paginated form, with
  `nextCursor` handling covered by tests.
- `prompts/get` renders a project template into valid MCP prompt messages and
  rejects unknown or malformed prompt names with precise JSON-RPC errors.
- Draft `server/discover` and `initialize` advertise prompt `listChanged` only
  when the server implements prompt-list notifications.
- `subscriptions/listen` validates and acknowledges `promptsListChanged`,
  sends `notifications/prompts/list_changed` with the subscription metadata
  when prompt files are created, deleted, or otherwise become visible through
  the prompt catalog, and cancels that subscription through the same
  cancellation path resources use.
- Existing MCP server prompt, completion, discovery, and resource subscription
  tests still pass.

## Source / Intent

Explorer opened this because the queue had no actionable work and all exposed
strategic blocked alternatives were still operator-capture gated:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

Research source: the current MCP draft prompts page at
https://modelcontextprotocol.io/specification/draft/server/prompts says
servers declare prompt capability metadata, `prompts/list` supports cursor
pagination, `prompts/get` may require additional input, and prompt list changes
use `notifications/prompts/list_changed` through `subscriptions/listen`.

Current-code evidence:

- `src/modules/mcp-server/prompts.ts` owns a static `KOTA_PROMPTS` array.
- `src/modules/mcp-server/mcp-handlers-prompts.ts` returns that array directly.
- `src/modules/mcp-server/mcp-handlers-initialize.ts` advertises
  `prompts: {}` for both draft and legacy capability paths.
- `src/modules/mcp-server/mcp-handlers-resources.ts` is the only
  `subscriptions/listen` implementation today.
- `src/modules/prompt-templates/AGENTS.md` and
  `src/modules/prompt-templates/prompt-template.ts` already make
  `.kota/prompts/` the project prompt-template source of truth.

The older completed task `task-mcp-server-prompts` added the first static MCP
prompt surface. This task is the follow-up alignment slice: use the existing
project prompt-template capability and the current draft prompt mechanics
instead of letting the first MCP implementation become the permanent registry.

## Initiative

MCP protocol fidelity and module-first prompt surfaces: KOTA should expose
project capabilities to MCP hosts through the same typed module-owned
mechanisms used by local sessions.

## Acceptance Evidence

- Focused test transcript, for example:
  `pnpm test src/modules/mcp-server/server.test.ts src/modules/prompt-templates/prompt-template.test.ts`.
- A test fixture project with at least two `.kota/prompts/*.md` files proves
  `prompts/list` pagination, template argument exposure, and `prompts/get`
  rendering.
- A protocol test or JSON-RPC transcript proves `subscriptions/listen` with
  `promptsListChanged: true` receives `notifications/prompts/list_changed`
  after the prompt catalog changes, or proves the server does not advertise
  prompt `listChanged` when that notification path is intentionally absent.
