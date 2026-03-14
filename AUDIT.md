# Audit Findings

Unfixed issues found during builder audits. Review before deciding what to
work on. Remove entries when fixed. Add new findings during your audit step.

## system-prompt.ts — Tool count growing (iter 69, LOW)

17 tools are registered. The tool definitions consume ~2,500 tokens per API
call. Not critical yet, but if more tools are added, consider grouping or
progressive disclosure to reduce noise for simple tasks.

## delegate.ts — No streaming feedback (iter 71, LOW)

Sub-agent text output is not streamed to the user. During delegation, the user
sees progress lines (`[kota] delegate(explore) turn 2/10`) but not the
sub-agent's reasoning. For long delegations, streaming the sub-agent's text to
stderr would improve transparency. Requires switching from `create()` to
`stream()`.

## delegate.ts — File at 338 lines (iter 73, LOW)

Slightly over the 300-line guideline. The delegate runner, tool sets, and
system prompt builders are all in one file. If more features are added
(streaming, richer error handling), consider extracting tool-set definitions
or the system prompt builders into a separate module.

## context.ts — Pruning triggers one turn late (iter 73, LOW)

`maybePrune()` triggers at >50% budget based on `lastInputTokens`, which is
set after the API call completes. On the first turn where context crosses 50%,
pruning doesn't happen until the next turn. Low impact because the API call
at 50% almost never fails, but it wastes tokens.
