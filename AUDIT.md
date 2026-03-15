# Audit Findings

Unfixed issues found during builder audits. Review before deciding what to
work on. Remove entries when fixed. Add new findings during your audit step.

## web-search.ts — DuckDuckGo HTML scraping (iter 77→307, RESOLVED)

Fixed in iter 307: `parseFallback` now pairs links/snippets by HTML position
instead of array index. Remaining risk: DDG HTML structure changes could break
both primary parser and fallback (general HTML scraping fragility). Brave
Search is primary provider; DDG is fallback only. No action needed.

## Test coverage — 1360 tests, all modules covered (iter 81→321, LOW)

All test files pass. Per-file test counts and cross-module suites are
visible in the source tree injected by step.sh — do not duplicate here.
No untested modules remain. Shell error pipeline has 18 cross-module tests.
HTTP data pipeline has 8 cross-module tests (save_to, table+truncation,
pipe escaping, format consistency). Todo→context pipeline has 7 cross-module
tests (hierarchy, duplication, budget interaction).

## Large files over 300-line limit (iter 127→163, LOW)

delegate.ts fixed (385 → ~280 lines) by extracting to delegate-format.ts.
loop.ts: ~304 lines (down from 314 after extracting architect step to
architect-runner.ts in iter 163). Config object construction prevents full
reduction — trimming blank lines or further refactoring would reach 300.
code-exec.ts fixed (333 → ~170 lines) by extracting REPLSession to
repl-session.ts in iter 161.
