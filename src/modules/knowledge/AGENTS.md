# Knowledge Module

This directory owns the `knowledge` management tool — a structured, file-based reference data layer backed by markdown files with YAML front matter.

- Owns the file-based `KnowledgeStore` implementation (`store.ts`,
  `store-helpers.ts`) that satisfies the `KnowledgeProvider` contract declared
  in `#core/modules/provider-types.js`.
- Registers itself as the `knowledge` provider on module load via
  `ctx.registerProvider("knowledge", new KnowledgeStore(ctx.cwd))`. Core does
  not provide a fallback implementation; callers must ensure the module has
  loaded (via the module runtime or `ensureCliProvidersFor(["knowledge"])`)
  before invoking `getKnowledgeProvider()`.
- Storage locations: `.kota/data/` (project-scoped) and `~/.kota/data/` (global).
- Registers `knowledge` in the `management` tool group.
- Contributes the `knowledge` skill (prompt guidance for storing and querying structured entries).
- Operator pull-surfaces consume the search seam through one shared HTTP route (`GET /api/knowledge/search`) and one shared line shape (`renderKnowledgeSearchPlain`): Telegram `/knowledge`, terminal `kota knowledge search`, embedded web `KnowledgePanel`, and the macOS menu bar `KnowledgeView`.

## Boundaries

- Does not own session-scoped working memory (that belongs in `working-memory/`).
- Does not own persistent note-style memory (that belongs in `memory/`).
- Modules that consume the knowledge store at runtime (currently
  `knowledge-semantic`) must list `knowledge` in their KotaModule
  `dependencies` so the loader orders onLoad correctly.
