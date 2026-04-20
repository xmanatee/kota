---
id: task-retire-srccoredata-by-moving-format-helpers-into-t
title: Retire src/core/data/ by moving format helpers into their owning modules
status: ready
priority: p2
area: architecture
summary: core/data/ currently holds format-specific helpers (CSV/JSON preview, HTML extraction, plot capture) used almost entirely by modules; relocate each helper to its owning module so core stays protocol-oriented and core/data/ disappears.
created_at: 2026-04-20T15:24:07.900Z
updated_at: 2026-04-20T15:24:07.900Z
---

## Problem

`src/core/AGENTS.md` describes core as the small protocol-oriented runtime
kernel: agent/session loop, workflow runtime, daemon, event bus, tool runtime,
and module lifecycle. `src/core/data/` is inconsistent with that charter. It
holds format-specific data helpers — CSV preview, JSON preview, HTML
extraction, HTML page extraction, plot capture, and code-execution wrappers —
most of which are consumed by modules, not by the kernel itself.

Concretely:

- `csv-preview.ts` and `json-preview.ts` are imported only by
  `src/modules/filesystem/file-read-formats.ts`.
- `html-extract.ts` and `html-page-extract.ts` are imported only by
  `src/modules/web-access/` (`web-fetch.ts`, `web-search-helpers.ts`).
- `plot-capture.ts` is imported only by `src/modules/execution/code-exec.ts`.
- `code-wrappers.ts` is imported by both core (`core/tools/repl-session.ts`,
  `core/tools/custom-tool.ts`, `core/tools/custom-tool-handlers.ts`,
  `core/manifest/execution.ts`) and `src/modules/execution/code-exec.ts`. This
  one is a genuine shared primitive and must not move into a module, because
  core cannot import from modules.

This shape is the same anti-pattern already called out in recent core-shrink
landings (architect, repo-tasks, mcp-server moves): product capability
accumulated in core because there was nowhere obvious to put it, not because
it is a runtime primitive. Retiring `core/data/` continues that thread and
leaves the core/module boundary coherent: format-specific helpers live with
the module whose tools consume them.

## Desired Outcome

- `src/core/data/` no longer exists as a directory. Its format-specific
  helpers have moved into the single module that consumes them.
- The one genuinely shared execution primitive (`code-wrappers.ts`) relocates
  to a clearly-named location in core (for example
  `src/core/tools/code-wrappers.ts`) so core tools can import it without
  pulling in a module.
- Each relocated helper lives next to its primary consumer, owns its tests,
  and uses internal package imports (`#modules/*`, `#core/*`) consistent with
  the rest of the repo.
- `src/core/AGENTS.md` no longer lists `data/` as a subtree. No parallel docs
  need to be added in the receiving modules beyond what the module's own
  `AGENTS.md` already covers at the conventions level.

## Constraints

- Core cannot import from modules. `code-wrappers.ts` therefore stays in core
  under a clearly-owned location; do not move it into `modules/execution/` and
  have core re-import it.
- Do not split a helper across two modules. If a helper is consumed by more
  than one module, either (a) declare it shared-primitive and keep it in
  core, or (b) pick the one module that owns it and have the other module
  declare the dependency explicitly per
  `src/modules/AGENTS.md` (the `KotaModule.dependencies` array).
- Preserve current public behavior, tests, and error messages. This is a move,
  not a rewrite.
- Follow the repo's "no two ways of doing the same thing" rule: delete the
  `core/data/` originals in the same commit as the moves. No re-export
  shims, no deprecated aliases.
- Keep commit scope tight: one commit per helper move is fine, or a single
  cohesive commit, but no mixing with unrelated edits.

## Done When

- `src/core/data/` is gone from the tree.
- `csv-preview.*` and `json-preview.*` live under `src/modules/filesystem/`.
- `html-extract.*` and `html-page-extract.*` live under
  `src/modules/web-access/`.
- `plot-capture.*` lives under `src/modules/execution/`.
- `code-wrappers.ts` (and its test) lives in a clearly core-owned location
  and is imported via `#core/...` from both core tools and the `execution`
  module.
- All call sites import from the new locations. No `#core/data/...` import
  remains in the repo.
- `src/core/AGENTS.md` no longer mentions `data/` as a subtree.
- `pnpm build`, `pnpm test`, and `pnpm typecheck` (or this repo's equivalents)
  pass on the updated tree with no behavior change.
