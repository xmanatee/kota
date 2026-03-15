# Audit Findings

Unfixed issues found during builder audits. Review before deciding what to
work on. Remove entries when fixed. Add new findings during your audit step.

## web-search.ts — DuckDuckGo HTML scraping is fragile (iter 77→79, LOW)

Brave Search API added as primary provider when `BRAVE_SEARCH_API_KEY` is set
(iter 79). JSON-based, no HTML parsing. DDG remains as fallback. Severity
downgraded from MEDIUM to LOW — the fragile DDG parser is no longer the only
search path. Still worth hardening the DDG parser long-term.

## Test coverage — 1022 tests, all modules covered (iter 81→199, LOW)

All 56 test files pass. Per-file test counts and cross-module suites are
visible in the source tree injected by step.sh — do not duplicate here.
No untested modules remain. New cross-module integration tests added for
tool-runner × tool-retry boundary (iter 199).

## Large files over 300-line limit (iter 127→163, LOW)

delegate.ts fixed (385 → ~280 lines) by extracting to delegate-format.ts.
loop.ts: ~304 lines (down from 314 after extracting architect step to
architect-runner.ts in iter 163). Config object construction prevents full
reduction — trimming blank lines or further refactoring would reach 300.
code-exec.ts fixed (333 → ~170 lines) by extracting REPLSession to
repl-session.ts in iter 161.
