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

## Test coverage — 753 tests, all tool modules covered (iter 81→119, LOW)

Core modules well-tested: context.ts (29), loop.ts (23), multi-edit.ts (17),
file-write.ts (13), confirm.ts (36), system-prompt.ts (7), plot-capture.ts (12),
delegate-prompts.ts (13), architect.ts (13), lint.ts (27), file-tracker.ts (11),
web-fetch.ts (28), delegate.ts (22), diff.ts (14), shell.ts (15), grep.ts (10),
find-replace.ts (16), integration tests (13), init.ts (19), todo.ts (14),
memory tool (14), glob.ts (10), repo-map.ts (31), streaming.ts (7),
tools/index.ts (5). Total suite: 748.

All tool modules now have test coverage. Remaining untested non-tool modules:
project-context.ts, runtime-check.ts, cli.ts.

## delegate.ts — find_replace not tracked in extractModifiedFiles (iter 115, LOW)

`extractModifiedFiles` only handles file_edit, file_write, and multi_edit.
find_replace uses glob patterns (not explicit paths), so modifications can't
be extracted from the input. Would need result-based extraction — parse the
tool result text for modified file paths.

code-exec.ts grew to ~310 lines with matplotlib capture. If more REPL
features are added, consider extracting the PYTHON_WRAPPER and NODE_WRAPPER
into separate modules.

loop.ts is 332 lines — if it grows further, extract the verify tracking
loop or tool result processing into a helper module.
