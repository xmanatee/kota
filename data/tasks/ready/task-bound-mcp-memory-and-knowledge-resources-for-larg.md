---
id: task-bound-mcp-memory-and-knowledge-resources-for-larg
title: Bound MCP memory and knowledge resources for large stores
status: ready
priority: p2
area: modules
summary: Make the MCP server expose memory and knowledge through bounded list/read/search surfaces instead of dumping entire stores as full-content resources.
created_at: 2026-05-20T03:06:31Z
updated_at: 2026-05-20T03:06:31Z
---

## Problem

KOTA's MCP server currently exposes `kota://memory` and `kota://knowledge` as
full-content JSON arrays. `resources/read` for either URI serializes every
entry body in the store, so a large memory or knowledge base can produce an
unbounded MCP payload, leak too much context into an MCP host, and make the
resource surface less useful for targeted grounding.

OpenAI Codex's 0.129.0 release moved its memories MCP surface toward shallow
listing, paginated list/search results, bounded reads, and contextual search
snippets. KOTA already has local memory/knowledge providers, semantic search,
and a first-party MCP server, but this MCP resource shape has not caught up to
the same bounded-context discipline.

## Desired Outcome

The MCP server exposes memory and knowledge through bounded, discoverable
surfaces:

- list/index reads are shallow and bounded rather than full-entry dumps;
- callers can fetch one specific memory or knowledge entry through an explicit
  MCP read path, with a content bound;
- search over memory and knowledge returns bounded hits with enough snippet or
  context to choose a follow-up read; and
- large stores fail loudly or page explicitly instead of silently returning
  partial or oversized payloads.

## Constraints

- Keep the work inside the `mcp-server` module unless an existing provider
  contract genuinely needs a typed extension.
- Do not add a parallel memory or knowledge registry; use the existing provider
  APIs and daemon-independent MCP server path.
- Treat MCP cursors and resource identifiers as opaque protocol values.
- Preserve strict decoding and test coverage for malformed requests; do not
  add silent truncation that callers cannot observe.
- The exact MCP identifiers belong in source and tests, not durable docs.

## Done When

- `kota://memory` and `kota://knowledge` no longer return every full entry body
  from the store as one unbounded JSON array.
- MCP callers have bounded list/index, single-entry read, and search paths for
  both memory and knowledge.
- Tests seed enough memory/knowledge content to prove list and search responses
  are bounded, single-entry reads are explicit, and malformed or out-of-range
  protocol input fails with useful diagnostics.
- Existing MCP server behavior for task, workflow, prompt, tool, elicitation,
  sampling, and roots methods remains unchanged.

## Source / Intent

- OpenAI Codex 0.129.0 release:
  https://github.com/openai/codex/releases/tag/rust-v0.129.0
- Local evidence:
  `src/modules/mcp-server/resources.ts` maps `kota://memory` and
  `kota://knowledge` to provider `.list()` calls and serializes full `content`
  for every returned entry.

This task came from the 2026-05-20 explorer watchlist refresh after the queue
was empty and the strategic blocked alternatives all required operator-captured
artifacts. It keeps the next ready item in the module-first MCP/runtime
interoperability lane rather than opening another client fan-out review.

## Initiative

MCP server quality: KOTA's MCP surfaces should stay useful and predictable as
project stores grow, with bounded context retrieval instead of all-or-nothing
store dumps.

## Acceptance Evidence

- Focused MCP server tests pass, for example:
  `pnpm test src/modules/mcp-server/server.test.ts`.
- The test fixture or transcript demonstrates a large memory and knowledge
  store where list/search responses stay bounded and full content is retrieved
  only through the explicit single-entry read path.
