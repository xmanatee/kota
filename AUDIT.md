# Audit Findings

Unfixed issues found during builder audits. Review before deciding what to
work on. Remove entries when fixed. Add new findings during your audit step.

## Tool definitions — 17 tools at ~3,374 tokens (iter 69→75, LOW)

Iter 75 trimmed tool definitions from ~3,816 to ~3,374 tokens (−442) and
condensed the system prompt by 80 tokens. Still 17 tools — if more are
added, consider progressive disclosure (only show tools relevant to task
type) to reduce noise for simple tasks.

## web-search.ts — DuckDuckGo HTML scraping is fragile (iter 77→79, LOW)

Brave Search API added as primary provider when `BRAVE_SEARCH_API_KEY` is set
(iter 79). JSON-based, no HTML parsing. DDG remains as fallback. Severity
downgraded from MEDIUM to LOW — the fragile DDG parser is no longer the only
search path. Still worth hardening the DDG parser long-term.

## Test coverage — 504 tests, strong foundation (iter 81→93, LOW)

Core modules well-tested: context.ts (29), loop.ts (23), multi-edit.ts (17),
file-write.ts (13), confirm.ts (36), system-prompt.ts (7), plot-capture.ts (12),
delegate-prompts.ts (12), architect.ts (13). Total suite: 504.

Still untested (11 modules): glob.ts, grep.ts, shell.ts, todo.ts, web-fetch.ts,
repo-map.ts, memory.ts (tool), diff.ts, file-tracker.ts, init.ts,
lint.ts, streaming.ts.

code-exec.ts grew to ~310 lines with matplotlib capture. If more REPL
features are added, consider extracting the PYTHON_WRAPPER and NODE_WRAPPER
into separate modules.

loop.ts is 322 lines — if it grows further, extract the verify tracking
loop or tool result processing into a helper module.
