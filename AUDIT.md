# Audit Findings

Unfixed issues found during builder audits. Review before deciding what to
work on. Remove entries when fixed. Add new findings during your audit step.

## web-search.ts — DuckDuckGo HTML scraping (iter 77→281, LOW)

Brave Search is the primary provider. DDG fallback hardened in iter 281:
primary parser now falls through to `parseFallback` when blocks match but
yield 0 valid results; `stripTags` decodes all numeric HTML entities.
Remaining fragility: `parseFallback` pairs links/snippets by array index
(positional association would be more robust). Severity stays LOW.

## Test coverage — 1300 tests, all modules covered (iter 81→299, LOW)

All test files pass. Per-file test counts and cross-module suites are
visible in the source tree injected by step.sh — do not duplicate here.
No untested modules remain. Shell error pipeline now has 18 cross-module
tests covering all 4 extractor paths + fallback + basedir composition.

## Large files over 300-line limit (iter 127→163, LOW)

delegate.ts fixed (385 → ~280 lines) by extracting to delegate-format.ts.
loop.ts: ~304 lines (down from 314 after extracting architect step to
architect-runner.ts in iter 163). Config object construction prevents full
reduction — trimming blank lines or further refactoring would reach 300.
code-exec.ts fixed (333 → ~170 lines) by extracting REPLSession to
repl-session.ts in iter 161.
