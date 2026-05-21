---
id: task-add-mcp-resource-template-listing-and-resource-list-pagi
title: Add MCP resource template listing and resource-list pagination
status: done
priority: p2
area: modules
summary: Align KOTA's MCP server resource surface with the draft Resources spec by adding paginated resources/list handling plus resources/templates/list for parameterized memory and knowledge reads.
created_at: 2026-05-21T20:35:30Z
updated_at: 2026-05-21T20:35:30Z
---

## Problem

KOTA's MCP server already exposes read-only resources and bounded
memory/knowledge reads, but the resource catalog is still treated as a small
static list. `resources/list` ignores cursor input and always returns the full
catalog, and KOTA does not implement `resources/templates/list` even though
memory and knowledge search/entry paths are already parameterized URI surfaces.

The current MCP draft Resources page treats both `resources/list` and
`resources/templates/list` as paginated operations. Claude Code's latest
release also calls out prompt/resource pagination past page 1 as a real MCP
interoperability failure mode. KOTA has already handled this carefully for
`tools/list` and `prompts/list`; resources should follow the same strict
protocol shape before the resource catalog grows further.

## Desired Outcome

The MCP server exposes resource discovery through strict, paginated handlers:
`resources/list` accepts an opaque cursor, rejects malformed or out-of-range
cursors, and returns `nextCursor` when the resource catalog spans multiple
pages. A new `resources/templates/list` handler advertises the parameterized
resource reads that already exist for memory and knowledge index/search/entry
flows, using the draft `resourceTemplates` shape and the same cursor discipline.

## Constraints

- Keep ownership inside `src/modules/mcp-server/`; this is MCP server adapter
  behavior, not a new core primitive.
- Do not create a parallel resource registry. Derive concrete resources and
  templates from the existing resource definitions and memory/knowledge
  provider availability.
- Treat cursors as opaque protocol values at the boundary. Do not silently
  ignore malformed cursor input.
- Preserve existing `resources/read`, resource subscriptions, list-changed
  notifications, prompt notifications, and compatibility behavior.
- Exact method names, template identifiers, cursor encodings, and payload
  shapes belong in source and focused tests.

## Done When

- `resources/list` supports cursor pagination and has focused tests covering
  first page, follow-up page, malformed cursor, and out-of-range cursor cases.
- `resources/templates/list` is registered in the MCP server dispatch table and
  returns deterministic template definitions for existing parameterized
  memory/knowledge resource reads when the corresponding providers are present.
- `resources/templates/list` supports cursor pagination with the same malformed
  and repeated/out-of-range safeguards used by other MCP list surfaces.
- Capability/discovery behavior remains coherent for clients that support
  resources; existing resource read and subscription tests remain green.
- A focused MCP server test proves KOTA no longer drops or hides template
  entries when the template catalog exceeds one page.

## Source / Intent

Explorer run `2026-05-21T20-32-53-675Z-explorer-s2i73f` reviewed an empty
actionable queue. The only backlog tasks were dependency-waiting on
`task-enable-autonomous-access-to-auth-walled-sources-so`, and the strategic
blocked alternatives were all operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Add MCP resource template listing and resource-list pagination" --state ready --area modules --priority p2 --summary "Align KOTA's MCP server resource surface with the draft Resources spec by adding paginated resources/list handling plus resources/templates/list for parameterized memory and knowledge reads."
```

It failed before writing a file with `Fatal: fetch failed`, so this normalized
task was created manually.

External signals checked:

- `https://github.com/anthropics/claude-code/releases` latest `v2.1.146`
  notes that MCP `resources/list`, `resources/templates/list`, and
  `prompts/list` pagination past page 1 caused dropped items in real clients.
- `https://modelcontextprotocol.io/specification/draft/server/resources`
  documents `resources/list` and `resources/templates/list` as paginated
  operations.

Local inspection found:

- `src/modules/mcp-server/mcp-handlers-resources.ts` handles `resources/list`
  by returning `listKotaResources()` directly and does not validate `cursor`.
- `src/modules/mcp-server/server.ts` registers `resources/list` and
  `resources/read`, but not `resources/templates/list`.
- `src/modules/mcp-server/resources.ts` already exposes parameterized memory
  and knowledge reads through `kota://memory/search?q={query}`,
  `kota://knowledge/search?q={query}`, and encoded entry read URIs.
- Existing done tasks cover `tools/list` pagination, `prompts/list`
  pagination, bounded memory/knowledge resource reads, and resource
  subscriptions, but not resource template listing.

## Initiative

MCP server protocol fidelity: KOTA should expose every first-party MCP
discovery surface with the same strict pagination and explicit catalog shape
used for tools and prompts.

## Acceptance Evidence

- Focused MCP server tests pass, for example:
  `pnpm test src/modules/mcp-server/server.test.ts`.
- The test fixture demonstrates both `resources/list` and
  `resources/templates/list` returning multiple pages without dropping entries,
  and malformed cursor requests failing with explicit JSON-RPC errors.
