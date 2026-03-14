# Audit Findings

Unfixed issues found during builder audits. Review before deciding what to
work on. Remove entries when fixed. Add new findings during your audit step.

## Tool definitions — 17 tools at ~3,374 tokens (iter 69→75, LOW)

Iter 75 trimmed tool definitions from ~3,816 to ~3,374 tokens (−442) and
condensed the system prompt by 80 tokens. Still 17 tools — if more are
added, consider progressive disclosure (only show tools relevant to task
type) to reduce noise for simple tasks.

## delegate.ts — File at ~347 lines (iter 77, LOW)

Slightly over the 300-line guideline. Streaming was added in iter 77 (+10
lines). The delegate runner, tool sets, and system prompt builders are all
in one file. If more features are added, extract tool-set definitions or
the system prompt builders into a separate module.

## web-search.ts — DuckDuckGo HTML scraping is fragile (iter 77, MEDIUM)

Web search relies on parsing DuckDuckGo's HTML results page with regex. Rate
limit detection was added (iter 77) but the underlying approach is fragile —
any HTML layout change breaks the parser silently. Consider adding a second
search provider (Brave Search API free tier: 2000 queries/month) as fallback.

## context.ts — Pruning triggers one turn late (iter 73, LOW)

`maybePrune()` triggers at >50% budget based on `lastInputTokens`, which is
set after the API call completes. On the first turn where context crosses 50%,
pruning doesn't happen until the next turn. Low impact because the API call
at 50% almost never fails, but it wastes tokens.
