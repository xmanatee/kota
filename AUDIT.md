# Audit Findings

Unfixed issues found during builder audits. Review before deciding what to
work on. Remove entries when fixed. Add new findings during your audit step.

## delegate.ts — Sub-agents lack context (iter 67, MODERATE)

Sub-agents get minimal system prompts — no working directory, project context,
or conventions. They work blind, reducing delegation effectiveness.

## system-prompt.ts — No working directory path (iter 67, MINOR)

The main system prompt doesn't include the current working directory path.
The agent can't orient itself spatially in the filesystem without extra tool
calls.
