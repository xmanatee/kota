---
id: task-align-mcp-server-card-with-the-experimental-extens
title: Align MCP Server Card with the experimental extension schema
status: done
priority: p2
area: modules
summary: Update KOTA's first-party MCP Server Card projection and well-known discovery endpoint to match the active MCP experimental Server Card extension instead of the older draft shape.
created_at: 2026-05-22T08:15:16Z
updated_at: 2026-05-22T08:29:26Z
---

## Problem

KOTA already exposes a first-party MCP Server Card, but the implementation was
completed against the earlier Server Card draft. The active MCP Server Card
work has since moved into an official experimental extension repository with a
different public shape: the card is treated as a static pre-initialization
connection document, the Server document remains the registry-shaped superset,
primitive listings are omitted, and the documented well-known path no longer
uses KOTA's current `.json` suffix.

Leaving the older projection in place risks advertising a shape that current
MCP clients, registries, or crawlers will not recognize once the experimental
extension graduates.

## Desired Outcome

KOTA's first-party MCP Server Card follows the current experimental extension
contract while preserving the existing module boundary:

- the card projection is derived from the same `server.json` and package
  metadata source of truth;
- the public card uses the current schema URL, identity fields, remote
  transport entries, and optional public `_meta` shape from the experimental
  extension;
- primitive catalogs stay runtime-discoverable through MCP list operations
  rather than being duplicated in the Server Card;
- the Streamable HTTP well-known endpoint and MCP resource path are updated or
  intentionally retained according to the active extension text and tests.

## Constraints

- Keep ownership in `src/modules/mcp-server/`; do not create a general MCP
  discovery registry or a second capability catalog.
- Treat the experimental extension as the source for the card projection, but
  keep the implementation strict enough that future schema drift fails loudly
  in focused tests.
- Do not preserve old Server Card field names or paths as compatibility aliases
  unless the current extension explicitly requires a transition period.
- Keep public-only output: no credentials, localhost/private endpoints, project
  paths, runtime sessions, or user-specific state.

## Done When

- `readMcpServerCard` emits a Server Card that matches the active
  `modelcontextprotocol/experimental-ext-server-card` schema and examples.
- The Streamable HTTP adapter serves the current well-known Server Card path
  with `application/json`, CORS, cache headers, and no MCP method dispatch.
- Any retained MCP resource path is backed by the current proposal text and
  returns the same card projection.
- Focused tests prove that KOTA omits primitive listings from the card, rejects
  private/publication-sensitive metadata, and keeps `server/discover` as the
  runtime capability source.

## Source / Intent

Explorer run `2026-05-22T08-13-16-034Z-explorer-f2th55` reviewed a queue with
zero actionable `ready`/`doing` tasks. The dependency-waiting backlog tasks
were still blocked on authenticated source access, and all strategic blocked
alternatives were operator-capture gated and not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

The scaffold command was attempted first:

```sh
pnpm kota task create "Align MCP Server Card with the experimental extension schema" --state ready --area modules --priority p2 --summary "Update KOTA's first-party MCP Server Card projection and well-known discovery endpoint to match the active MCP experimental Server Card extension instead of the older draft shape."
```

It failed before writing a file with `Fatal: fetch failed`, so this normalized
task was created manually.

External signals checked:

- `https://modelcontextprotocol.io/community/server-card/charter` says the
  Server Card Working Group owns the Server Card document format, discovery
  mechanism, guidance for authors and consumers, and coordination with the
  Registry WG so Server Cards stay close to a subset of `server.json`.
- `https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127`
  remains the draft SEP for Server Cards and is still open under the
  transport-evolution roadmap label.
- `https://github.com/modelcontextprotocol/experimental-ext-server-card`
  is now the official experimental extension surface. Its README says it is
  the TypeScript source of truth plus generated JSON Schema for Server Cards,
  documents `https://<host>/.well-known/mcp/server-card`, treats the Server
  document as the registry superset that adds local `packages`, and says Server
  Cards intentionally omit tools, resources, and prompts.

Local evidence:

- `src/modules/mcp-server/server-card.ts` currently emits
  `https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json`,
  `serverInfo`, a singular `transport`, and a coarse `capabilities` summary.
- `src/modules/mcp-server/streamable-http.ts` currently serves only
  `/.well-known/mcp/server-card.json`.
- `src/modules/mcp-server/server.test.ts` and
  `src/modules/mcp-server/streamable-http.test.ts` lock in the older shape.
- The completed `task-add-mcp-server-card-discovery-for-kotas-first-part`
  explicitly followed the proposal current at implementation time, so this is
  follow-up protocol drift rather than unfinished prior work.

## Initiative

MCP ecosystem readiness: KOTA's first-party MCP server should advertise the
current official Server Card shape while keeping runtime capabilities in MCP
protocol operations and preserving module-owned implementation boundaries.

## Acceptance Evidence

- Focused MCP server tests pass, including updated Server Card resource and
  Streamable HTTP well-known coverage.
- A fixture or transcript under `.kota/runs/<run-id>/` captures the current
  well-known Server Card response and any retained MCP resource response,
  showing schema-valid public metadata and no primitive listings, secrets,
  private endpoints, project-local paths, or user/session state.
- `pnpm test src/modules/mcp-server/*.test.ts` passes.

## Completion Evidence

- Updated KOTA's Server Card projection to the experimental extension shape:
  top-level identity fields, public absolute `remotes` only when declared in
  registry metadata, optional public `_meta`, and no primitive listings or old
  draft `serverInfo`/`transport`/`capabilities` fields.
- Switched Streamable HTTP discovery to `/.well-known/mcp/server-card` while
  retaining `mcp://server-card.json` as the post-connection MCP resource for
  the same current projection.
- Captured the current well-known and MCP resource responses in
  `.kota/runs/2026-05-22T08-18-46-933Z-builder-nyfjov/server-card-responses.json`
  and the full focused test transcript in
  `.kota/runs/2026-05-22T08-18-46-933Z-builder-nyfjov/mcp-server-focused-test-transcript.txt`.
- Verification passed:
  `pnpm test src/modules/mcp-server/*.test.ts`, `pnpm typecheck`, and
  `pnpm lint`.
