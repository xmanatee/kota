# Tools

This directory contains core tool implementations and registrations.

- Keep tool behavior explicit, well-scoped, and self-registering where possible.
- Cross-cutting tool composition should stay readable; avoid hiding tool semantics inside unrelated runtime code.

## Key Modules

- `web-search.ts` — `webSearchTool` schema, `runWebSearch` runner, Brave/DDG fetch logic, and registration.
- `web-search-helpers.ts` — HTML parsing, result formatting, rate-limit detection, and URL resolution for web search.
- `file-edit.ts` — `fileEditTool` schema, `runFileEdit` runner, and registration.
- `file-edit-helpers.ts` — Whitespace-tolerant matching, fuzzy not-found messaging, and similarity scoring for file edits.
