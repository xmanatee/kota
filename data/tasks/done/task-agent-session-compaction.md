---
id: task-agent-session-compaction
title: Add automatic context compaction for long-running agent sessions
status: done
priority: p2
area: runtime
summary: Long builder or explorer sessions accumulate context that approaches model token limits. Without compaction, sessions fail with context-length errors and the operator must restart the run manually.
created_at: 2026-03-31T12:22:00Z
updated_at: 2026-03-31T13:03:00Z
---

## Problem

Agent sessions grow their message history with every tool call and model turn. Once the accumulated context approaches the model's context window, the session fails with a token limit error. This is most common for builder runs with many file-editing steps.

There is no automatic strategy to trim or summarize conversation history. Operators must shorten prompts, restart runs, or split tasks — none of which is ergonomic in an autonomous workflow context.

## Desired Outcome

When an agent session's context size approaches a configurable threshold (e.g. 80% of `maxTokens`), the runtime applies a compaction strategy:

- **Rolling trim**: drop the oldest assistant/tool message pairs while preserving the system prompt and the most recent N turns.
- Optionally, a **summary step**: before trimming, run a short summarization pass to produce a `<context-summary>` block that is injected in place of dropped messages.
- The compaction strategy is configurable per-agent in the agent definition or session config.
- Compaction events are logged so operators can diagnose unexpectedly long sessions.

The rolling trim alone is the minimum viable outcome; summary injection is a bonus.

## Constraints

- The system prompt and the last user message must never be dropped.
- Compaction must not change the external message history stored in the history store — it only trims the in-memory context passed to the model.
- Do not apply compaction by default if `maxTokens` is unset; only activate when a threshold is derivable.
- Keep the compaction logic inside the session layer, not the workflow layer.

## Done When

- Sessions no longer fail with context-length errors when the rolling-trim strategy is enabled.
- Compaction is logged to the session log with the number of messages dropped.
- The strategy is configurable: at minimum `rollingTrim` (default off), with optional `keepLastN` parameter.
- Existing session tests pass unmodified.
- At least one unit test exercises compaction triggering and verifies history is trimmed correctly.
