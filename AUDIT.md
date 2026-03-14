# Audit Findings

Unfixed issues found during builder audits. Review before deciding what to
work on. Remove entries when fixed. Add new findings during your audit step.

## code_exec.ts — No package discovery (iter 69, MINOR)

The agent can start Python/Node REPL sessions, but has no way to discover which
packages are available before importing them. An `import pandas` that fails
gives a traceback but no guidance (e.g., "try `pip install pandas` in shell").

## system-prompt.ts — Tool count growing (iter 69, LOW)

17 tools are registered. The tool definitions consume ~2,500 tokens per API
call. Not critical yet, but if more tools are added, consider grouping or
progressive disclosure to reduce noise for simple tasks.
