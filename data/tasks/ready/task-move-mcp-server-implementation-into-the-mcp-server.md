---
id: task-move-mcp-server-implementation-into-the-mcp-server
title: Move MCP server implementation into the mcp-server module
status: ready
priority: p2
area: architecture
summary: Relocate src/core/mcp/server.ts plus its prompts.ts, resources.ts, and server.test.ts into modules/mcp-server so the implementation lives with its only consumer, following the sqlite-memory and semantic-index extraction pattern
created_at: 2026-04-19T16:29:05.920Z
updated_at: 2026-04-19T16:29:05.920Z
---

## Problem

`src/core/mcp/server.ts` (812 lines), plus its co-located
`prompts.ts` (143 lines), `resources.ts` (172 lines), and
`server.test.ts` (1879 lines), hold the full "expose KOTA tools over
MCP stdio" implementation. The only non-test consumer is
`src/modules/mcp-server/index.ts`, which dynamic-imports
`#core/mcp/server.js` to construct an `McpServer`. No other core
subsystem depends on server/prompts/resources.

That split violates the core boundary stated in
`docs/ARCHITECTURE.md` — "MCP integration … should prefer
module-owned capability packs unless a shared runtime primitive
truly has to stay in core" — and mirrors the confusing seam called
out in `src/modules/mcp-server/AGENTS.md`, which currently points
readers back into core ("Actual MCP server implementation lives in
`src/core/mcp/server.ts`") to explain the module.

The MCP client side is different. `src/core/mcp/client.ts` and
`src/core/mcp/manager.ts` are imported by the session loop
(`loop-init.ts`, `loop.ts`, `tool-runner.ts`, `delegate-*.ts`) to
connect KOTA as a client to other MCP servers and merge their tools
into the runtime tool list. That is a real session-loop runtime
primitive, not a module-owned capability pack.

Recent extractions established the pattern for the
server-side half:

- `task-move-sqlitememoryprovider-implementation-into-the-` moved
  the SQLite memory provider into the sqlite-memory module.
- `task-extract-semantic-index-engine-out-of-core-into-a-s`
  moved the semantic-index engine into its module.

Both turned an empty-shim module wrapping a core file into a
module that owns its implementation end-to-end. The MCP server is
the next obvious candidate.

## Desired Outcome

- The MCP server implementation, its prompt and resource helpers,
  and its focused tests live under `src/modules/mcp-server/`.
- `src/core/mcp/server.ts`, `src/core/mcp/prompts.ts`,
  `src/core/mcp/resources.ts`, and `src/core/mcp/server.test.ts`
  are deleted. There is no compatibility re-export from
  `#core/mcp/server.js`.
- `src/modules/mcp-server/index.ts` imports `McpServer` from its
  own module tree, not from `#core/mcp/...`.
- `src/core/mcp/` retains only the client-side runtime primitive
  (`client.ts`, `manager.ts` and their tests), which continues to
  be consumed by the session loop and the tool runner.
- `src/core/mcp/AGENTS.md` is updated to describe the directory as
  the client/manager used by the session loop; the server-side
  guidance moves into `src/modules/mcp-server/AGENTS.md`, which
  stops pointing readers into core.
- `pnpm test` and `pnpm typecheck` pass with the server living in
  the module.

## Constraints

- This is a file-move and import-path refactor, not a functional
  rewrite. MCP stdio transport, tool exposure, prompt rendering,
  resource reading, sampling behavior, and elicitation semantics
  must stay byte-for-byte equivalent.
- Keep the `ModelClient`, `EventBus`, `CostTracker`,
  `WorkflowRunStore`, and guardrails-classify contracts where they
  already live. Only the MCP-server-specific glue moves.
- Do not move `client.ts` or `manager.ts`. The session loop's
  dependence on those is unchanged; they are the runtime primitive
  that has to stay in core.
- Do not introduce a module-to-core import from the mcp-server
  module back into `#core/mcp/`. After the move, `#core/mcp/`
  should not export server, prompts, or resources at all.
- No compatibility shims, no aliased re-exports, no transitional
  `@deprecated` pointers. Delete the core files in the same change
  that adds the module copies.
- Respect the module-dependency declaration rule: if the
  mcp-server module ends up importing from another module at
  runtime (it likely stays self-contained plus `#core/*`), declare
  that in its `dependencies` array so `module-deps.test.ts` stays
  green.
- Do not expand scope to MCP client/manager changes, sampling
  protocol edits, or new tool-annotation work. Those are separate
  concerns.

## Done When

- `src/core/mcp/server.ts`, `src/core/mcp/prompts.ts`,
  `src/core/mcp/resources.ts`, and `src/core/mcp/server.test.ts`
  no longer exist; `src/core/mcp/` contains only the client and
  manager and their tests.
- `src/modules/mcp-server/` owns the `McpServer` class and its
  prompt/resource helpers plus the co-located tests; the CLI
  command defined by the module imports from the module tree.
- `src/core/mcp/AGENTS.md` and
  `src/modules/mcp-server/AGENTS.md` describe the new split, and
  the module AGENTS.md no longer says the implementation lives in
  core.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` all pass.
- `src/module-deps.test.ts` still passes, and the mcp-server
  module's `dependencies` array is updated if the move introduces
  new runtime dependencies on other modules.
