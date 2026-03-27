# Tools

This directory contains core tool implementations and registrations.

- Keep tool behavior explicit, well-scoped, and self-registering where possible.
- Cross-cutting tool composition should stay readable; avoid hiding tool semantics inside unrelated runtime code.

## Key Modules

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
