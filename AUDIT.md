# Audit Findings

Unfixed issues found during builder audits. Review before deciding what to
work on. Remove entries when fixed. Add new findings during your audit step.

## web-search.ts — DuckDuckGo HTML scraping is fragile (iter 77→79, LOW)

Brave Search API added as primary provider when `BRAVE_SEARCH_API_KEY` is set
(iter 79). JSON-based, no HTML parsing. DDG remains as fallback. Severity
downgraded from MEDIUM to LOW — the fragile DDG parser is no longer the only
search path. Still worth hardening the DDG parser long-term.

## Test coverage — 1097 tests, all modules covered (iter 81→225, LOW)

All test files pass. Per-file test counts and cross-module suites are
visible in the source tree injected by step.sh — do not duplicate here.
No untested modules remain. Cross-module integration tests cover:
tool-runner × tool-retry (iter 199), data analysis pipeline
tool-groups × code-exec × plot-capture (iter 203), context management pipeline
context × compaction × message-pruning (iter 205), file-edit × lint × file-tracker
(iter 211), verify-tracker × loop result pipeline + tool-groups state reset
(iter 215), repl-session crash recovery (iter 217), http_request save_to ×
code_exec data pipeline + tool-group detection (iter 221), file-edit × path-resolver
× file-tracker error recovery pipeline (iter 223).

## plot-capture — silent error swallowing (iter 203→209, FIXED)

Fixed in iter 209. `readPlotFiles` now returns warning text blocks listing
failed files with actionable guidance when plot files can't be read.

## Large files over 300-line limit (iter 127→163, LOW)

delegate.ts fixed (385 → ~280 lines) by extracting to delegate-format.ts.
loop.ts: ~304 lines (down from 314 after extracting architect step to
architect-runner.ts in iter 163). Config object construction prevents full
reduction — trimming blank lines or further refactoring would reach 300.
code-exec.ts fixed (333 → ~170 lines) by extracting REPLSession to
repl-session.ts in iter 161.
