# Knowledge Module

This directory owns the `knowledge` management tool — a structured, file-based reference data layer backed by markdown files with YAML front matter.

- Owns the file-based `KnowledgeStore` implementation (`store.ts`,
  `store-helpers.ts`) that satisfies the `KnowledgeProvider` contract declared
  in `#core/modules/provider-types.js`.
- Registers itself as the knowledge provider on module load via the typed
  `KNOWLEDGE_PROVIDER_TOKEN` (re-exported from
  `#core/modules/provider-registry.js`). Core does not provide a fallback
  implementation; callers must ensure the module has loaded (via the
  module runtime or `ensureCliProvidersFor(["knowledge"])`) before
  invoking `getKnowledgeProvider()`.
- Storage locations: `.kota/data/` (scope-scoped) and `~/.kota/data/` (global).
- Creates and updates install a complete markdown record with an atomic rename;
  an interrupted temporary file is not a `.md` record and is ignored on restart.
  Deletes use the filesystem's atomic unlink, so readers observe the record or
  its absence rather than partial contents.
- Daemon/API access resolves a concrete scope id before using the scope
  store. Omitted scope ids resolve to the daemon's active/default scope at
  the route or client boundary; explicit unknown ids return the typed
  `unknown_scope` route error.
- Registers `knowledge` in the `management` tool group.
- Contributes the `knowledge` skill (prompt guidance for storing and querying structured entries).
- Telegram and terminal search consume the shared HTTP route and line renderer.
  Visual clients render the module's shared-UI contribution instead of owning
  knowledge-specific screens or routes.
- The module contributes its own live knowledge-store shared-UI surface rather
  than entering a daemon-owned store catalog.

## Boundaries

- Does not own session-scoped working memory (that belongs in `working-memory/`).
- Does not own persistent note-style memory (that belongs in `memory/`).
- Modules that consume the knowledge store at runtime (currently
  `knowledge-semantic`) must list `knowledge` in their KotaModule
  `dependencies` so the loader orders onLoad correctly.
- The base provider is keyword-only. Embedding-backed implementations declare
  `semanticSearchCapability`; callers inspect that structural capability and
  report explicit unavailability when it is absent.
