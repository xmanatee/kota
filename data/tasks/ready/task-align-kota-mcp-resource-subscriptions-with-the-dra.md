---
id: task-align-kota-mcp-resource-subscriptions-with-the-dra
title: Align KOTA MCP resource subscriptions with the draft resources protocol
status: ready
priority: p2
area: modules
summary: Update the MCP server resource capability and subscription path to match the current draft resources protocol while preserving existing resource-read behavior.
created_at: 2026-05-20T04:50:42.532Z
updated_at: 2026-05-20T04:50:42.532Z
---

## Problem

KOTA's MCP server still exposes resource updates through the older resource
subscription shape: `initialize` advertises `resources: { subscribe: true }`,
`resources/subscribe` records a URI, and bus events send
`notifications/resources/updated` only to those per-URI subscriptions.

The current MCP draft Resources page now models this differently. Resource
servers declare `resources.listChanged` when the resource catalog can change,
send `notifications/resources/list_changed` for catalog updates, and use
`subscriptions/listen` with `notifications.resourceSubscriptions` for specific
resource update streams. KOTA already supports the useful behavior of
resource reads and per-resource update notifications, but the advertised
capability and subscription method are drifting from the draft protocol that
current clients will implement.

## Desired Outcome

KOTA's MCP server resource surface matches the current draft protocol while
preserving its existing resource-read semantics:

- Initialization advertises resource capabilities that match the draft shape
  KOTA actually supports.
- Resource catalog changes have an explicit `resources.listChanged` /
  `notifications/resources/list_changed` path when KOTA's known resource set
  changes.
- Per-resource updates are available through the draft `subscriptions/listen`
  stream shape, including `notifications.resourceSubscriptions`.
- Existing `resources/list`, `resources/read`, and older host behavior are
  either intentionally preserved behind one explicit compatibility boundary or
  removed with focused tests proving the new protocol path.

## Constraints

- Keep this inside `src/modules/mcp-server/`; do not pull server resource
  helpers into `src/core/mcp/`.
- Treat MCP as a transport over KOTA capabilities, not a second resource
  registry.
- Do not add polling. Use protocol notifications and the existing event bus
  signals.
- Keep exact method names and payload shapes in source and tests, not in a
  durable docs catalog.
- Do not regress the completed bounded memory/knowledge resource behavior.

## Done When

- The MCP server initialize response advertises the draft-aligned resource
  capability shape for the negotiated protocol version.
- A focused protocol test proves a client can open a `subscriptions/listen`
  stream with resource subscriptions and receive
  `notifications/resources/updated` for `workflow.completed` and
  `task.changed`.
- A focused test proves KOTA emits `notifications/resources/list_changed` only
  when the server's listed resource catalog changes, not for every content
  update.
- Existing resource list/read tests, bounded memory/knowledge resource tests,
  MCP prompt/tool/sampling tests, and roots-list-change tests remain green.
- If legacy `resources/subscribe` stays, it is isolated as a compatibility
  branch with tests that show it cannot diverge from the draft path.

## Source / Intent

Explorer run `2026-05-20T04-47-57-411Z-explorer-5y0v1r` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and were not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create 'Align KOTA MCP resource subscriptions with the draft resources protocol' --state ready --area modules --priority p2 --summary 'Update the MCP server resource capability and subscription path to match the current draft resources protocol while preserving existing resource-read behavior.'
```

It failed before writing a file because the command's local preflight returned
`Fatal: fetch failed` in the workflow sandbox. This file was created through
the same repo-task scaffold implementation.

External source checked:

- `https://modelcontextprotocol.io/specification/draft/server/resources` is
  the official MCP draft Resources page. It documents
  `resources.listChanged`, `notifications/resources/list_changed`,
  `subscriptions/listen`, and `notifications.resourceSubscriptions`.

Local evidence:

- `src/modules/mcp-server/mcp-handlers-initialize.ts` currently advertises
  `resources: { subscribe: true }`.
- `src/modules/mcp-server/mcp-handlers-resources.ts` handles
  `resources/subscribe` / `resources/unsubscribe` and sends
  `notifications/resources/updated` from bus events.
- Existing completed resource work covers static list/read behavior, bounded
  memory/knowledge resources, and per-resource update notifications, but not
  the current draft list-changed and subscription-stream shape.

## Initiative

MCP protocol fidelity: KOTA's first-party MCP server should stay aligned with
the current protocol draft through one tested adapter boundary.

## Acceptance Evidence

- Focused MCP server protocol tests pass, for example:
  `pnpm test src/modules/mcp-server/server.test.ts`.
- Test fixtures show a draft client subscribing through `subscriptions/listen`
  and receiving resource update notifications without using
  `resources/subscribe`.
- A regression test or explicit fixture shows catalog-change notifications are
  separate from resource-content update notifications.
