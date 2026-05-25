---
id: task-preserve-assistant-thinking-context-through-compac
title: Preserve assistant thinking context through compaction
status: done
priority: p2
area: core
summary: Make KOTA's context compaction preserve bounded assistant thinking/rationale blocks so stale-session or repeated compaction cannot erase the reasoning history needed to continue multi-turn tool work.
created_at: 2026-05-25T11:01:04.686Z
updated_at: 2026-05-25T11:10:13.091Z
---

## Problem

KOTA's neutral transcript protocol has an explicit assistant thinking block:
`KotaThinkingBlock` carries extended-thinking text plus a signature, and the
protocol comment says the loop round-trips those blocks on subsequent turns.
The context compaction path does not currently preserve that channel. In
`src/core/loop/compaction.ts`, `buildConversationText` includes assistant text,
tool calls, and tool results, but silently skips `thinking` blocks before it
asks the summarizer to produce the compacted context.

That creates the same failure shape Anthropic described in its April 23, 2026
Claude Code quality post: stale-session context management that repeatedly
drops older thinking made the agent forget why it chose edits and tools, leading
to repetition and odd tool choices. KOTA already treats runtime/core-loop
changes as high-risk, so compaction should not erase reasoning context while
claiming to preserve enough state for a seamless continuation.

Current local evidence:

- `src/core/agent-harness/message-protocol.ts` defines `KotaThinkingBlock`.
- `src/core/loop/compaction.ts` omits `thinking` blocks from the compaction
  source text.
- Existing context tests cover tool-result pruning, structured working state,
  repeated compaction, and image/delegate observations, but not preservation of
  assistant thinking/rationale blocks.

## Desired Outcome

Context compaction preserves bounded assistant thinking/rationale context
alongside the existing deterministic working-state summary. A compacted session
still tells the next turn why the agent selected the active plan, tool sequence,
and follow-up checks, without leaking provider signatures or unbounded hidden
content into user-visible artifacts.

## Constraints

- Keep this in the core loop; do not add a second session-memory store or an
  autonomy-specific summary path.
- Preserve the existing transcript protocol. Do not replace `thinking` blocks
  with provider-specific fields or nullable compatibility shims.
- Bound the copied thinking content. Long thinking blocks should be truncated
  or summarized before they reach the compaction prompt, and signatures must
  not be exposed in the narrative summary.
- Do not send thinking summaries to critic input, run-review artifacts, or
  operator reports. This is session-continuity context, not evaluator evidence.
- Keep read-only tool pruning behavior intact; this task is about preserving
  assistant-side rationale during compaction, not widening what tool results
  are kept verbatim.

## Done When

- `compactMessages` / `buildConversationText` includes assistant thinking
  context in a bounded, clearly labeled way when preparing the summarizer input.
- Compaction output preserves enough of a prior assistant thinking block for a
  resumed turn to recover the active plan/rationale, while omitting the
  provider signature.
- Repeated compaction does not erase the thinking-derived rationale after the
  first compaction summary becomes ordinary narrative input.
- Tests cover:
  - a mixed assistant message with `thinking`, text, and `tool_use` blocks;
  - a long thinking block that is bounded before summarization;
  - signature omission from the compaction prompt and compacted output;
  - repeated compaction preserving the prior thinking-derived plan.
- Existing `src/core/loop/` context, pruning, and compaction tests remain green.

## Source / Intent

Explorer run `2026-05-25T10-57-40-813Z-explorer-jx5k8p` reviewed an empty
actionable queue. The strategic blocked alternatives all still require
operator-captured artifacts and are not movable:

- `task-add-cross-preset-runtime-parity-gate`
- `task-add-streamable-http-transport-to-the-mcp-server`
- `task-capture-an-end-to-end-coding-task-parity-artifact-`
- `task-enable-autonomous-access-to-auth-walled-sources-so`
- `task-introduce-a-rich-cli-rendering-abstraction-for-all`

External source checked:

- `https://www.anthropic.com/engineering/april-23-postmortem` reports that
  Claude Code quality issues came from three product-layer changes: default
  reasoning effort was reduced, a stale-session context optimization
  repeatedly cleared older thinking, and a system prompt verbosity line hurt
  coding quality. The directly actionable KOTA gap is the thinking-pruning
  analogue in core compaction.

Local evidence:

- `src/core/loop/compaction.ts` currently builds compaction input from text,
  tool-use, and tool-result blocks only.
- `src/core/agent-harness/message-protocol.ts` says assistant thinking blocks
  are transcript content that providers with a thinking channel round-trip.
- Repository search found no existing open task for thinking-block preservation
  through compaction.

## Initiative

Reliable long-running sessions: KOTA should preserve the reasoning context
needed to continue multi-turn tool work after pruning, compaction, idle
resumption, or provider-specific transcript compression.

## Acceptance Evidence

- Focused tests pass, for example
  `pnpm test src/core/loop/compaction.test.ts src/core/loop/context-pipeline.test.ts`.
- A regression fixture or unit assertion shows a thinking block with a unique
  plan token surviving compaction in bounded summary form, with the original
  thinking signature absent from both the summarizer input and compacted
  messages.
