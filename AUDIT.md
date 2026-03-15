# Audit Findings

Unfixed issues found during builder audits. Review before deciding what to
work on. Remove entries when fixed. Add new findings during your audit step.

## web-search.ts — DuckDuckGo HTML scraping (iter 77→307, RESOLVED)

Fixed in iter 307: `parseFallback` now pairs links/snippets by HTML position
instead of array index. Remaining risk: DDG HTML structure changes could break
both primary parser and fallback (general HTML scraping fragility). Brave
Search is primary provider; DDG is fallback only. No action needed.

## Flaky test: code-exec node error output (iter 355, LOW)

code-exec.test.ts "reports errors without crashing" intermittently fails — expects "test error" in output but gets "(no output)". Node REPL subprocess timing race. Not blocking.

## Test coverage — 1463 tests, 0 failing (iter 81→355, LOW)

All test files pass. Per-file test counts and cross-module suites are
visible in the source tree injected by step.sh — do not duplicate here.
No untested modules remain. MCP client has 13 tests including full lifecycle
tests (connect→listTools→callTool→close) using a real spawned fake server.
Shell error pipeline has 18 cross-module tests. HTTP data pipeline has 8
cross-module tests. Todo→context pipeline has 12 cross-module tests.
Init→loop session startup pipeline has 9 cross-module tests. Memory pipeline
has 9 cross-module tests. System prompt→tool-groups registry has 2
cross-module tests.

## Large files over 300-line limit (iter 127→163, LOW)

delegate.ts fixed (385 → ~280 lines) by extracting to delegate-format.ts.
loop.ts: ~304 lines (down from 314 after extracting architect step to
architect-runner.ts in iter 163). Config object construction prevents full
reduction — trimming blank lines or further refactoring would reach 300.
code-exec.ts fixed (333 → ~170 lines) by extracting REPLSession to
repl-session.ts in iter 161.
