# Tools

This directory contains shared tool runtime primitives and the remaining
core-hosted tool implementations.

- Keep tool behavior explicit, well-scoped, and self-registering where
  possible.
- Do not treat `src/tools/` as the default home for every new capability. If a
  tool belongs to a cohesive built-in capability pack, prefer moving that pack
  behind an extension boundary instead of growing this bucket further.
- Cross-cutting tool composition should stay readable; avoid hiding tool semantics inside unrelated runtime code.

## Key Modules

- `index.ts` — central core tool registry and dispatch surface (`getCoreRegistrations`, `getAllTools`, `executeTool`, `registerTool`). This file should trend toward host/runtime concerns rather than remaining the long-term home of general-purpose built-in capabilities.
- `web-search.ts` — `webSearchTool` schema, `runWebSearch` runner, Brave/DDG fetch logic, and registration.
- `web-search-helpers.ts` — HTML parsing, result formatting, rate-limit detection, and URL resolution for web search.
- `file-edit.ts` — `fileEditTool` schema, `runFileEdit` runner, and registration.
- `file-edit-helpers.ts` — Whitespace-tolerant matching, fuzzy not-found messaging, and similarity scoring for file edits.
- `computer-use-actions.ts` — Re-exports all platform actions and `needCoords`; `resetComputerUseState` delegates to both platform reset functions.
- `computer-use-actions-shared.ts` — `EXEC_OPTS`, `parseCombo`, `truncText`, `needCoords` shared by both platform files.
- `computer-use-actions-mac.ts` — macOS click, type, key, scroll, drag, and cursor actions using cliclick/osascript.
- `computer-use-actions-linux.ts` — Linux click, type, key, scroll, drag, and cursor actions using xdotool.
- `custom-tool.ts` — `customToolTool` schema, `runCustomTool` dispatcher, `initCustomToolRegistry`, persistence lifecycle, and registration.
- `custom-tool-handlers.ts` — `handleCreate`, `handleList`, `handleRemove` action handlers and `buildRunner` execution builder for custom tools.
- `knowledge-schema.ts` — `knowledgeTool` Anthropic tool schema definition (static, no runner logic).
- `knowledge.ts` — `formatEntry`, `formatEntryFull` helpers and `runKnowledge` async runner; re-exports `knowledgeTool` from `knowledge-schema.ts`.
