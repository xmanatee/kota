---
id: task-distill-new-claude-blog-posts-into-autonomy-decisi
title: Distill new Claude blog posts into autonomy decisions
status: ready
priority: p2
area: research
summary: Read the new Claude blog posts on Opus 4.7 best practices, session management plus 1M context, and production-MCP agent integration; fold decision-level takeaways into src/modules/autonomy/AGENTS.md or record as 'read, no action'.
created_at: 2026-04-23T13:38:04.133Z
updated_at: 2026-04-23T13:38:04.133Z
---

## Problem

`src/modules/autonomy/AGENTS.md` already carries distillation bullets for
peer runtimes, Anthropic engineering, OpenAI research, and DeepMind/Google
posts. Since the previous `claude.com/blog` fingerprint
(`sha256:9e730b29ad0ccf46b2032e434ea50b54`, summarized as
"parallel-agents / agent-coordination / Managed Agents / tool-design /
enterprise"), Anthropic has shipped additional posts directly adjacent to
KOTA's autonomy loop and not yet distilled:

- "Best practices for using Claude Opus 4.7 with Claude Code" — advises
  `xhigh` default effort, adaptive (not fixed-budget) thinking, front-
  loading intent/constraints/criteria in the first turn, and treating the
  agent as a delegatee rather than a pair programmer. Likely reinforces
  but may also extend the existing "Opus 4.7 harness defaults at the
  agent-step layer" bullet.
- "Using Claude Code: session management and 1M context" — introduces a
  five-way decision matrix (continue / rewind / `/compact` / `/clear` /
  subagent) for context lifecycle, and calls out context rot as the
  fundamental reason to shed state. Relevant to KOTA's session, compaction,
  and decomposer/builder primitives.
- "Building agents that reach production systems with MCP" — production-
  posture guidance for MCP integration. Relevant to KOTA's MCP module and
  foreign-module transport work.

Secondary posts ("Preparing your security program for AI-accelerated
offense", hackathon winners) are likely reference-only relative to KOTA's
decisions but should be recorded as read.

Without folding these in, future runs risk re-deriving guidance already
published by Anthropic or silently drifting from the upstream harness
recommendation.

## Desired Outcome

Each named post is read against KOTA's current autonomy model and either:

- Folded into `src/modules/autonomy/AGENTS.md` as a decision-level
  takeaway (adopt / reject / defer + KOTA subsystem touched), extending or
  refining the existing "External Pattern Decisions", "Prompt Hierarchy
  And Harness Posture", or a new short subsection as appropriate;
- Recorded honestly as "read, no action" in the same doc if the post does
  not change a KOTA decision.

Any concrete gap surfaced (e.g. a missing session-lifecycle primitive or
an MCP production posture KOTA lacks) opens a follow-up implementation
task in `data/tasks/backlog/` rather than silently expanding this task's
scope.

## Constraints

- Keep takeaways decision-focused and short, matching the existing
  distillation bullets. Do not duplicate source-post content or balloon
  `AGENTS.md` headroom.
- Do not infer post content from titles or third-party summaries. Read
  each post through an authenticated/rendered fetch path if the plain
  `WebFetch` call fails.
- Do not add a second lessons store or peer-post archive. `AGENTS.md` and
  `data/watchlist.yaml` are the single surfaces for distilled peer signal.
- If a post introduces a primitive KOTA already has under a different
  name, reject the peer pattern explicitly rather than adopting a parallel
  surface.
- Update `data/watchlist.yaml` fingerprint summary if the distillation run
  re-reads `claude.com/blog` and confirms the new surface.

## Done When

- The three named Claude-blog posts are read and each has an explicit
  decision-level line (adopt/reject/defer or "read, no action") in
  `src/modules/autonomy/AGENTS.md`.
- Any follow-up implementation task surfaced by the distillation is
  opened in `data/tasks/backlog/` with a one-line link back to this task.
- `data/watchlist.yaml` snapshot for `claude.com/blog` reflects the
  updated surface (fingerprint + summary).
- No documentation rot introduced: duplicate or superseded bullets elsewhere
  in `autonomy/AGENTS.md` are pruned in the same commit per
  `AGENTS.md` Maintenance rules.
