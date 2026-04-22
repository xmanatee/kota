---
id: task-evaluate-4-inbox-sourced-external-links-for-explor
title: Evaluate 4 inbox-sourced external links for explorer watchlist or research
status: done
priority: p3
area: research
summary: Explorer reads four operator-captured links (Google Stitch design.md post and repo, Nous Hermes-Agent, Anthropic Claude Opus 4.7 best-practices post) and routes each to watchlist, a focused takeaway, or honest drop.
created_at: 2026-04-22T16:47:05.231Z
updated_at: 2026-04-22T16:55:52.562Z
---

## Problem

Four external links were captured in `data/inbox/more-links-to-explore.md`
without disposition:

- https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/
- https://github.com/google-labs-code/design.md
- https://github.com/nousresearch/hermes-agent
- https://claude.com/blog/best-practices-for-using-claude-opus-4-7-with-claude-code

None of them are currently on `data/watchlist.yaml`, and none has a focused
takeaway recorded against KOTA. The watchlist policy rejects aggregator
indexes but welcomes durable project repos and engineering/blog pages with
their own cadence, so each link needs an individual read to decide whether it
belongs on the watchlist, turns into a focused decision, or should be dropped
with an honest reason.

## Desired Outcome

Each of the four links has an explicit disposition recorded:

- Added to `data/watchlist.yaml` with a snapshot summary, if the source is a
  durable project or self-updating research surface.
- Or converted into a focused decision entry in the relevant `AGENTS.md`
  (autonomy, architecture, cli, or similar), if the source yields a concrete
  KOTA decision.
- Or dropped with a short written rationale (too vendor-specific, already
  covered, not actionable, etc.).

No link is left in an unread or handwaved state.

## Constraints

- Do not add aggregator indexes or "awesome-*" lists to the watchlist even if
  tempting. Evaluate each URL against the watchlist rules in
  `data/AGENTS.md`.
- If a source cannot be fetched (auth wall, 4xx, paywall), mark it as
  `status: inaccessible` on the watchlist (if it belongs there) or surface it
  to the auth-walled-source task rather than silently deferring. Do not infer
  content from URL shape.
- Keep any `AGENTS.md` takeaway decision-level and short, per the existing
  distillation patterns in `src/modules/autonomy/AGENTS.md`.
- Do not create one follow-up task per URL. One cohesive task, one cohesive
  disposition record.

## Done When

- Each of the four URLs has been either added to the watchlist with a
  snapshot, folded into a focused `AGENTS.md` takeaway, or dropped with a
  recorded rationale.
- Inaccessible sources are flagged honestly, not silently dropped.
- The inbox note `more-links-to-explore.md` no longer exists (it is
  superseded by this task's dispositions).

## Dispositions

### 1. https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/

**Drop.** One-off announcement blog post for the DESIGN.md spec. The durable
surface is the `google-labs-code/design.md` repo (evaluated separately as
link #2); the blog post itself will not update on a useful cadence and is not
a watchlist candidate under `data/AGENTS.md` rules.

### 2. https://github.com/google-labs-code/design.md

**Drop.** Active durable repo (~2.6k stars, releases, CLI), but the domain is
AI-assisted design-system tooling: YAML design tokens plus Markdown rationale
consumed by UI-generating coding agents. KOTA is a personal-assistant agent
runtime with no design-system generation surface, and the "frontmatter +
markdown body" structure is already standard in KOTA's task format. No KOTA
decision to fold into an `AGENTS.md` takeaway, and no peer-runtime signal to
justify watchlist inclusion.

### 3. https://github.com/nousresearch/hermes-agent

**Added to `data/watchlist.yaml`.** Direct peer to KOTA: Nous Research's
open-source personal-assistant runtime with agent-curated persistent memory,
autonomous skill self-improvement, FTS5 session search with LLM summarization,
built-in cron scheduler, MCP integration, Agentskills.io skill interop, and
40+ tools across six terminal backends. High overlap with KOTA's
`module` + `workflow` + `session` + store model; worth monitoring for patterns
that might pressure KOTA's own protocols.

### 4. https://claude.com/blog/best-practices-for-using-claude-opus-4-7-with-claude-code

**Drop the specific post; add parent `claude.com/blog` to watchlist.** The
individual post is a stable single URL, not a self-updating surface. Its
parent `claude.com/blog` is a durable Anthropic product blog (distinct from
`anthropic.com/engineering`, already on the watchlist) that lands Claude Code
release notes and model-specific best-practices posts. The specific post's
load-bearing takeaways — delegate-don't-pair framing, `xhigh` as default
effort, adaptive thinking over fixed budgets, batch prompts upfront — either
validate KOTA's existing autonomy-loop posture or are harness-specific
defaults that belong in a future `claude-agent-sdk` harness adapter rather
than a cross-harness `AGENTS.md` decision. Per
`src/modules/autonomy/AGENTS.md`: "Promote a lesson only when repeated run
evidence shows a durable pattern." A single blog read does not meet that bar.
