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

## Test coverage — 865 tests, all modules covered (iter 81→149, LOW)

Core modules well-tested: context.ts (29), loop.ts (27), multi-edit.ts (17),
file-write.ts (13), confirm.ts (36), system-prompt.ts (7), plot-capture.ts (12),
delegate-prompts.ts (13), architect.ts (13), lint.ts (27), file-tracker.ts (11),
web-fetch.ts (28), delegate-format.ts (38), diff.ts (14), shell.ts (15),
grep.ts (10), find-replace.ts (16), integration tests (13), init.ts (19),
todo.ts (17, includes cross-module lifecycle + system prompt injection tests),
memory tool (14), glob.ts (10), repo-map.ts (31), streaming.ts (7),
tools/index.ts (5), project-context.ts (7), runtime-check.ts (2),
file-read.ts (28, includes PDF + document format + binary detection tests),
cli.ts (4, subprocess tests for entry point + option parsing),
code-exec.ts (25, includes SIGINT interrupt + timeout recovery tests),
verify-tracker.ts (31, includes 7 cross-module processToolResults tests).
Cross-module: shell-pipeline (6) — shell-diagnostics → error-context composition;
tool-runner-integration (11) — executeToolCalls × tool-retry retry pipeline +
rich-block truncation (code_exec → plot-capture → context-aware truncation);
verify-tracking (7) — processToolResults × VerifyTracker for all tool types.
Total suite: 865.

No untested modules remain.

## Large files over 300-line limit (iter 127→149, LOW)

delegate.ts fixed (385 → ~280 lines) by extracting to delegate-format.ts.
loop.ts: ~314 lines (down from 348 after extracting verify-tracking to
verify-tracker.ts in iter 149). Extracting architect mode block (~30 lines)
would bring it under 300.
code-exec.ts: ~310 lines. Extract PYTHON_WRAPPER and NODE_WRAPPER if more
REPL features are added. Severity remains LOW — both files only slightly over.
