---
id: task-review-external-agent-architecture-references
title: Review external agent architecture references
status: done
priority: p2
area: research
summary: Triage a set of external agent-related papers, posts, and repos for ideas that could materially improve KOTA.
created_at: 2026-03-19
updated_at: 2026-03-19
---

## Problem

Several external agent architecture references have been captured but not reviewed. They may contain ideas applicable to KOTA's runtime, workflow engine, tool system, or prompting strategy.

## Desired Outcome

Each reference is assessed and either:
- Produces one or more concrete backlog items, or
- Is explicitly dropped as not applicable.

## Constraints

- Do not add speculative features; only extract concrete, actionable ideas.
- Keep new tasks focused — prefer enriching existing open tasks over creating duplicates.

## Done When

All references below have been evaluated and the task is moved to done with a brief note on what (if anything) was captured.

## Outcome

9 of 13 references were accessible and evaluated. 4 were inaccessible (rate limits, JS-render, or not fetched). 3 of the inaccessible references have a grouped follow-up task (`task-review-inaccessible-research-resources-when-access`); 1 (chatterbox) was dropped based on repo metadata. Full notes in `.kota/runs/2026-03-19T06-18-28-201Z-builder-9mjgwc/research-notes.md`.

Captured into backlog:
- `task-context-compaction-strategy` — Handle long-session context overflow
- `task-tool-description-policy` — Add "when NOT to use" guidance to tool descriptions
- `task-discovery-action-separation` — Separate discovery vs action tools structurally
- `task-approval-gates-for-consequential-actions` — Runtime-enforced gates for irreversible actions

Dropped as not applicable:
- open-pencil — design tool, not an agent framework
- resemble-ai/chatterbox — not fetched, but repo name and description confirm audio TTS; unrelated

Inaccessible — unread, follow-up created:
- glthr.com/XML-fundamental-to-Claude — inaccessible (rate limit / JS render); follow-up: `task-review-inaccessible-research-resources-when-access`
- bengubler.com/posts/2026-02-25-introducing-helm — inaccessible; follow-up: `task-review-inaccessible-research-resources-when-access`
- arxiv.org/abs/2511.18423 — not fetched, topic unknown; follow-up: `task-review-inaccessible-research-resources-when-access`

## References

- https://glthr.com/XML-fundamental-to-Claude (INACCESSIBLE)
- https://www.bengubler.com/posts/2026-02-25-introducing-helm (INACCESSIBLE)
- https://arxiv.org/abs/2511.18423 (not fetched)
- https://github.com/martian-engineering/lossless-claw → task-context-compaction-strategy
- https://github.com/wu-yc/LabClaw → task-tool-description-policy
- https://github.com/open-pencil/open-pencil → DROPPED
- https://github.com/andrewyng/context-hub → task-tool-description-policy
- https://github.com/RightNow-AI/openfang → task-approval-gates-for-consequential-actions
- https://github.com/resemble-ai/chatterbox → DROPPED (audio TTS)
- https://github.com/alinaqi/claude-bootstrap → task-discovery-action-separation, task-approval-gates-for-consequential-actions
- https://github.com/here-build/foundation → task-discovery-action-separation
- https://justin.abrah.ms/blog/2026-01-05-wrapping-my-head-around-gas-town.html → task-context-compaction-strategy
- https://sankalp.bearblog.dev/my-experience-with-claude-code-20-and-how-to-get-better-at-using-coding-agents/ → task-tool-description-policy, task-context-compaction-strategy
