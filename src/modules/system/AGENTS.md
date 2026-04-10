# System Module

This directory contains the system capability pack — a repo module that owns host OS interaction tools.

- This is the canonical home for clipboard, image-viewing, environment-discovery, and SQLite tools. Do not add these to `src/core/tools/`.
- Tools, helpers, and tests are co-located here, following the pattern established by `web-access/` and `filesystem/`.
- Read-only tools (`clipboard` read, `view_image`, `env_info`) are classified as safe in guardrails.
- Write tools (`clipboard` write) and mutating tools (`sqlite` query) are classified as safe/moderate respectively.

## Key Modules

- `index.ts` — Module definition; assembles all tools into the `systemModule` export.
- `clipboard.ts` — `clipboardTool` schema, `readClipboard`/`writeClipboard` helpers, and `runClipboard` runner; macOS (pbpaste/pbcopy) and Linux (xclip) support.
- `view-image.ts` — `viewImageTool` schema and `runViewImage` runner; reads PNG/JPEG/GIF/WebP and returns base64 for visual analysis; downsizes images above 1568px using sips (macOS) or ImageMagick (Linux).
- `env-info.ts` — `envInfoTool` schema and `runEnvInfo` runner; delegates to `env-probes.ts` query functions.
- `env-probes.ts` — `queryOS`, `queryRuntimes`, `queryServices`, `queryResources` helpers; each probes the host system using standard OS APIs and CLI tools.
- `sqlite.ts` — `sqliteTool` schema and `runSqlite` runner; uses the `sqlite3` CLI to run SQL, list tables, and inspect schemas; results formatted as markdown tables.

## Boundaries

- Does not own shell execution, code REPL, or file I/O — those belong in `execution/` and `filesystem/`.
- Does not own web/HTTP access — that belongs in `web-access/`.
- Does not own git operations — that belongs in `git/`.
