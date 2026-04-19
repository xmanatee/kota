---
id: task-extract-semantic-index-engine-out-of-core-into-a-s
title: Extract semantic-index engine out of core into a shared module
status: done
priority: p2
area: architecture
summary: Move the embedding-provider, cosine, semantic-index, and semantic-index-manager code from src/core/memory/semantic/ into a module-owned capability pack since only memory-semantic and knowledge-semantic consume it, keeping core small per the module-first rule
created_at: 2026-04-19T12:18:05.500Z
updated_at: 2026-04-19T13:08:19.361Z
---

## Problem

`src/core/memory/semantic/` holds a self-contained embedding capability
pack (HTTP embedding provider, cosine similarity, sidecar index format,
and a generic `SemanticIndexManager`) that is consumed exclusively by the
`memory-semantic` and `knowledge-semantic` modules. Nothing in core —
agent loop, workflow runtime, daemon, channels, tools, guardrails — ever
reaches into this directory. It is an HTTP/web-access + memory-backend
capability sitting inside the minimal runtime kernel.

The top-level `AGENTS.md` architecture section is explicit:

> General-purpose capabilities should not accumulate in the core by default.
> Browser use, shell/process access, filesystem actions, HTTP/web access,
> memory backends, MCP integration, and operator surfaces should prefer
> module-owned capability packs unless a shared runtime primitive truly has
> to stay in core.

The semantic-index engine fits the "capability pack" description and does
not have a shared-runtime reason to live in core. Leaving it there
normalizes the pattern of parking general-purpose capability inside the
kernel, which is precisely what the core-boundary rule exists to prevent.

## Desired Outcome

- The embedding provider, cosine math, sidecar index format, and
  `SemanticIndexManager` live inside the module layer, shared by the two
  existing `-semantic` modules through normal module-to-module imports
  rather than `#core/memory/semantic/*`.
- `src/core/memory/` stops exposing semantic primitives; the remaining
  core surface is just the file-based stores and their protocol types.
- The two consumer modules continue to work unchanged from the operator's
  perspective: configuring `providers.memory = "memory-semantic"` or
  `providers.knowledge = "knowledge-semantic"` still activates semantic
  search with the same config keys.
- Module dependency declarations are updated so the loader enforces load
  order between the new shared module and its consumers.

## Constraints

- Pick one clear home for the shared code. Either a new module whose
  single job is to host the engine, or fold the engine into one of the
  two consumers and re-export it for the other. Do not create two copies.
- Do not introduce a parallel alias system. If a new module is created,
  it follows the standard `src/modules/<name>/` layout and resolves via
  `#modules/<name>/*` like every other module.
- Do not weaken existing test coverage during the move. The existing
  cosine / index / embedding-provider tests should migrate with the code
  or be replaced by equivalent tests in the new location.
- Do not spawn a new top-level doc to explain the rearrangement. The
  local `AGENTS.md` in the new owning directory absorbs the two-paragraph
  description currently at `src/core/memory/semantic/AGENTS.md`.
- Declare inter-module dependencies correctly per
  `src/modules/AGENTS.md`: if `memory-semantic` or `knowledge-semantic`
  imports from a new shared module at runtime, they must list it in
  their `dependencies` array so the loader orders them after it.
- Keep the change cohesive in one PR. A half-moved engine with some
  consumers still importing `#core/memory/semantic/*` is a confusing
  seam; finish the move in one pass.

## Done When

- No file under `src/core/memory/semantic/` exists; `src/core/memory/`
  contains only the file-based store protocol and implementation.
- No source file in the repo imports from `#core/memory/semantic/*`.
- `memory-semantic` and `knowledge-semantic` work end-to-end with
  their existing tests passing, whether they import a new shared
  module or share code through one of the two modules.
- Any new module contributes its shared code via standard module
  exports, and `dependencies` arrays reflect the new import graph so
  `src/module-deps.test.ts` remains green.
- The `AGENTS.md` that previously described the engine at
  `src/core/memory/semantic/AGENTS.md` moves with the code or is
  replaced by an equivalent description at the new location. No new
  top-level doc is added.
- `pnpm test` and `pnpm build` both pass after the move.
