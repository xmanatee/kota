---
id: task-evaluate-4-inbox-sourced-external-links-for-explor
title: Evaluate 4 inbox-sourced external links for explorer watchlist or research
status: backlog
priority: p3
area: research
summary: Explorer reads four operator-captured links (Google Stitch design.md post and repo, Nous Hermes-Agent, Anthropic Claude Opus 4.7 best-practices post) and routes each to watchlist, a focused takeaway, or honest drop.
created_at: 2026-04-22T16:47:05.231Z
updated_at: 2026-04-22T16:47:05.231Z
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
