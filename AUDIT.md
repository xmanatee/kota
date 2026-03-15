# Audit Findings

Unfixed issues found during builder audits. Review before deciding what to
work on. Remove entries when fixed. Add new findings during your audit step.

## Tool definitions — 18 tools at ~3,550 tokens (iter 69→109, LOW)

Iter 109 added find_replace (18th tool, ~176 tokens). Total tool definitions
~3,550 tokens. Consider progressive disclosure (only show tools relevant to
task type) to reduce noise for simple tasks.

## web-search.ts — DuckDuckGo HTML scraping is fragile (iter 77→79, LOW)

Brave Search API added as primary provider when `BRAVE_SEARCH_API_KEY` is set
(iter 79). JSON-based, no HTML parsing. DDG remains as fallback. Severity
downgraded from MEDIUM to LOW — the fragile DDG parser is no longer the only
search path. Still worth hardening the DDG parser long-term.

## Test coverage — 962 tests, all modules covered (iter 81→185, LOW)

Core modules well-tested: context.ts (29), loop.ts (27), multi-edit.ts (17),
file-write.ts (13), confirm.ts (36), system-prompt.ts (7), plot-capture.ts (12),
delegate-prompts.ts (17), architect.ts (13), architect-runner.ts (7),
lint.ts (27), file-tracker.ts (11),
web-fetch.ts (33, includes 5 cross-module HTML extraction tests),
delegate-format.ts (38), diff.ts (14), shell.ts (15),
grep.ts (10), find-replace.ts (16), integration tests (13), init.ts (19),
todo.ts (17, includes cross-module lifecycle + system prompt injection tests),
memory tool (14), glob.ts (10), repo-map.ts (31), streaming.ts (11),
tools/index.ts (5), project-context.ts (7), runtime-check.ts (2),
file-read.ts (28, includes PDF + document format + binary detection tests),
cli.ts (4, subprocess tests for entry point + option parsing),
code-exec.ts (38, includes SIGINT interrupt + timeout recovery + auto-install + hint interaction tests),
repl-session.ts (16, lifecycle + 7 cross-module execute + 4 venv detection tests — iter 181),
verify-tracker.ts (34, includes 10 cross-module processToolResults tests),
code-wrappers.ts (12, protocol markers + Python/Node.js subprocess integration),
html-extract.ts (33, includes 6 table conversion tests — iter 169).
Cross-module: shell-pipeline (6) — shell-diagnostics → error-context composition;
tool-runner-integration (11) — executeToolCalls × tool-retry retry pipeline +
rich-block truncation (code_exec → plot-capture → context-aware truncation);
verify-tracking (10) — processToolResults × VerifyTracker for all tool types
+ assembleDelegateResult → processToolResults roundtrip (3 tests, iter 155);
web-fetch-html (5) — runWebFetch × extractContent for HTML pages (iter 157);
code-wrappers-subprocess (8) — Python/Node.js wrapper subprocess execution,
AST extraction, error handling (iter 163).
repl-session-execute (7) — REPLSession.execute × code-wrappers sentinel protocol:
Python/Node.js execution, state persistence, stderr collection, restart after
kill, SIGINT timeout, output cleanliness (iter 171).
csv-metadata (9) — CSV/TSV metadata prepending in file_read: header detection,
quoted headers, TSV delimiter, empty data, offset/limit with metadata (iter 173),
embedded delimiters, escaped quotes, single-line, mixed quoted/unquoted (iter 177).
csv-truncation (2) — runFileRead CSV × truncateToolResult: metadata preserved
after truncation, metadata in head portion of large result (iter 177).
system-context (3) — date/platform in session warmup: date format with day of
week, date matches local time, platform info included (iter 175).
streaming-retry (4) — mid-stream failure retry, text reset on retry,
thinking events verbose + non-verbose stderr output (iter 179).
venv-detection (4) — findPythonBinary: no-venv fallback, .venv detection,
venv detection, .venv-over-venv preference (iter 181).
venv-auto-install (5) — detectPackageHint × findPythonBinary: venv binary in
install command, system python3 fallback, default pip, cross-module flow,
node hint unaffected (iter 183).
file-edit-pipeline (6) — runFileEdit × lintFile × file-tracker: successful
edit through lint, lint-reverted edit restores file, whitespace-tolerant match
through lint gate, whitespace match lint revert, fuzzy match error with line
numbers, stale warning on externally modified file (iter 185).
dir-overview (6) — getDirectoryOverview: empty dir null, mixed files/dirs listing,
hidden + noise filtering, file truncation (>15), dir truncation (>10),
buildSessionWarmup integration with directory section (iter 187).
delegate-context (5) — buildSubAgentPrompt × detectProject × getDirectoryOverview:
project type from package.json, directory listing with files/dirs, empty dir omission,
ordering (cwd → project → directory → projectContext), noise filtering (iter 189).
Total suite: 973.

No untested modules remain. All modules above minimum test density threshold.

## code-exec.ts — extractMissingPackage rejects dotted npm names (iter 177, LOW)

`extractMissingPackage` validates Node.js package names with `[a-zA-Z0-9_-]+`
which excludes dots. Packages like `socket.io` won't trigger auto-install.
Rare in practice — most npm packages use hyphens, not dots.

## Large files over 300-line limit (iter 127→163, LOW)

delegate.ts fixed (385 → ~280 lines) by extracting to delegate-format.ts.
loop.ts: ~304 lines (down from 314 after extracting architect step to
architect-runner.ts in iter 163). Config object construction prevents full
reduction — trimming blank lines or further refactoring would reach 300.
code-exec.ts fixed (333 → ~170 lines) by extracting REPLSession to
repl-session.ts in iter 161.
