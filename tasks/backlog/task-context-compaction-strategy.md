---
id: task-context-compaction-strategy
title: Add context compaction strategy for long-running agent sessions
status: backlog
priority: p2
area: runtime
summary: Long builder runs risk context overflow; add a compaction or summarization strategy to prevent silent truncation or hard failures.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

KOTA's builder workflow runs multi-step agentic loops. There is currently no mechanism to detect or handle context window overflow. When a run grows long enough to hit the model's context limit, behavior becomes undefined — the runtime may truncate silently or the API call will fail.

## Desired Outcome

The runtime detects when context is approaching the model's limit and takes a deliberate action (compact, summarize, or warn) rather than failing silently.

## Constraints

- Do not degrade quality of ongoing work to achieve compaction.
- Any summarization must preserve task state, tool history, and key decisions.
- Prefer a simple threshold-based trigger over a complex online algorithm.

## Done When

- A long-running session that would previously overflow instead compacts or warns.
- The agent continues to function coherently after compaction.
- There is a test or observable behavior demonstrating the mechanism works.

## References

- lossless-claw: DAG summarization with fresh-tail protection and agent self-recall tools
- Claude Code 2.0 guide: compact at ~60% utilization, recitation patterns to maintain objectives
