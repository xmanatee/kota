# Knowledge Extension

This directory owns the `knowledge` management tool — a structured, file-based reference data layer backed by markdown files with YAML front matter.

- Storage locations: `.kota/data/` (project-scoped) and `~/.kota/data/` (global).
- Registers `knowledge` in the `management` tool group.
- Contributes the `knowledge` skill (prompt guidance for storing and querying structured entries).

## Files

- `index.ts` — `KotaExtension` definition; registers the tool and skill.
- `knowledge.ts` — `knowledgeTool` schema and `runKnowledge` runner.
- `knowledge-schema.ts` — shared type definitions and schema helpers for knowledge entries.

## Boundaries

- Does not own the `knowledge` CLI commands (`kota knowledge …`) — those live in `src/memory-cli.ts`.
- Does not own session-scoped working memory (that belongs in `working-memory/`).
- Does not own persistent note-style memory (that belongs in `memory/`).
