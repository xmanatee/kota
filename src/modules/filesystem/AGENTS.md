# Filesystem Extension

This directory contains the filesystem capability pack — a built-in extension that owns all filesystem tools.

- This is the canonical home for file and directory tools. Do not add new filesystem tools to `src/tools/`.
- Tools, helpers, and tests are co-located here, following the pattern established by `web-access/`.
- Read-only tools (`file_read`, `glob`, `grep`, `files_overview`) are classified as safe in guardrails.
- Write tools (`file_write`, `file_edit`, `multi_edit`, `find_replace`, `file_watch`) are classified as moderate.

## Key Modules

- `index.ts` — Extension definition; assembles all tools into the `filesystemModule` export.
- `file-read.ts` — `fileReadTool` schema and `runFileRead` runner; supports text, JSON, CSV, JSONL, TSV previews via `file-read-formats.ts`.
- `file-read-formats.ts` — Format-specific preview helpers used by `file-read.ts`.
- `file-write.ts` — `fileWriteTool` schema and `runFileWrite` runner.
- `file-edit.ts` — `fileEditTool` schema and `runFileEdit` runner; uses `diff.ts` and `file-edit-helpers.ts`.
- `file-edit-helpers.ts` — Whitespace-tolerant matching, fuzzy not-found messaging, and similarity scoring.
- `diff.ts` — `printEditDiff` and `printWriteSummary` diff formatters used by edit/write tools.
- `multi-edit.ts` — `multiEditTool` schema and `runMultiEdit` runner; batch edits with atomic rollback.
- `find-replace.ts` — `findReplaceTool` schema and `runFindReplace` runner; regex find-and-replace with preview.
- `glob.ts` — `globTool` schema and `runGlob` runner.
- `grep.ts` — `grepTool` schema, `runGrep` runner, and `formatCountOutput` helper; supports files_only and count_only modes.
- `file-watch.ts` — `fileWatchTool` schema and `runFileWatch` runner; manages background file watchers.
- `files-overview.ts` — `filesOverviewTool` schema and `runFilesOverview` runner; categorized directory summary with previews.
