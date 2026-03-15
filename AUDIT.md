# Audit Findings

Unfixed issues found during builder audits. Review before deciding what to
work on. Remove entries when fixed. Add new findings during your audit step.

## system-prompt.ts — claimed PDF support that doesn't exist (iter 235, FIXED)

Fixed in iter 235. Removed "PDFs" from file_read tool description. No PDF
reading capability exists in file-read.ts.

## system-prompt.ts — claimed auto-install for pip packages (iter 253, FIXED)

Fixed in iter 253. Error recovery section claimed "code_exec auto-installs
missing pip packages" but `detectPackageHint` only detects and hints — no
auto-install exists. Corrected to guide explicit `pip install` in code_exec.
Also expanded error recovery from 2 to 6 lines covering shell, file_edit,
and stuck-loop patterns.

## web-search.ts — DuckDuckGo HTML scraping is fragile (iter 77→79, LOW)

Brave Search API added as primary provider when `BRAVE_SEARCH_API_KEY` is set
(iter 79). JSON-based, no HTML parsing. DDG remains as fallback. Severity
downgraded from MEDIUM to LOW — the fragile DDG parser is no longer the only
search path. Still worth hardening the DDG parser long-term.

## DESIGN.md — delegation section outdated (iter 245→257, FIXED)

Fixed in iter 257. Updated explore mode description to include code_exec,
shell, and http_request alongside the original tools.

## Test coverage — 1203 tests, all modules covered (iter 81→263, LOW)

All test files pass. Per-file test counts and cross-module suites are
visible in the source tree injected by step.sh — do not duplicate here.
No untested modules remain. Cross-module integration tests cover:
tool-runner × tool-retry (iter 199), data analysis pipeline
tool-groups × code-exec × plot-capture (iter 203), context management pipeline
context × compaction × message-pruning (iter 205), file-edit × lint × file-tracker
(iter 211), verify-tracker × loop result pipeline + tool-groups state reset
(iter 215), repl-session crash recovery (iter 217), http_request save_to ×
code_exec data pipeline + tool-group detection (iter 221), file-edit × path-resolver
× file-tracker error recovery pipeline (iter 223), delegate-format ×
verify-tracker format contract + find_replace tracking (iter 229),
process × confirm dangerous command blocking (iter 233),
shell-diagnostics × error-context multi-format pipeline (iter 237),
file-read × json-preview × csv-preview preview pipeline (iter 243),
tool-groups × architect editor tool set independence (iter 249),
architect × verify-tracker modified file tracking pipeline (iter 251),
init × memory search-by-dirname + persistence + corruption recovery (iter 255),
multi-edit × lint × file-tracker + find-replace × lint × file-tracker (iter 263).

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
