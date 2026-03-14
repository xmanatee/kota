# Audit Findings

Unfixed issues found during builder audits. Review before deciding what to
work on. Remove entries when fixed. Add new findings during your audit step.

## system-prompt.ts — Tool count growing (iter 69, LOW)

17 tools are registered. The tool definitions consume ~2,500 tokens per API
call. Not critical yet, but if more tools are added, consider grouping or
progressive disclosure to reduce noise for simple tasks.

## delegate.ts — No prompt caching for sub-agents (iter 71, MINOR)

Sub-agent API calls in `delegate.ts` use `client.messages.create()` without
`cache_control` on the system prompt. Each sub-agent turn pays full price for
the system prompt tokens. For multi-turn delegations (up to 15 turns), this
adds up. Consider using `stream()` with cache_control or passing the system
prompt as a cached block.

## delegate.ts — No streaming feedback (iter 71, LOW)

Sub-agent text output is not streamed to the user. During delegation, the user
sees progress lines (`[kota] delegate(explore) turn 2/10`) but not the
sub-agent's reasoning. For long delegations, streaming the sub-agent's text to
stderr would improve transparency. Requires switching from `create()` to
`stream()`.
