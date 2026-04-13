---
id: task-reprocess-inaccessible-research-resources-honestly
title: Reprocess inaccessible research resources honestly
status: ready
priority: p1
area: research
summary: Revisit historical resource dispositions, especially auth-walled X links, and convert unread resources into honest blocked/follow-up work instead of dismissed research.
created_at: 2026-04-13T21:37:53.066Z
updated_at: 2026-04-13T21:37:53.066Z
---

## Problem

Historical resource-review work recorded several URL-dependent items as
dismissed or reference-only even when the source content was not actually
processed. The clearest current example is the X/Twitter section in
`docs/RESOURCE-PACKET-DISPOSITION.md`, where auth-walled links are marked
"Dismissed — cannot review". That is not an honest terminal outcome: the system
did not learn from the resource and did not create a blocker or enabler task.

This can hide valuable user-provided resources and makes future agents believe
the research front is complete when it is only inaccessible.

## Desired Outcome

Historical inaccessible resource entries are reprocessed into an honest durable
state. If a source was not read, the repo should say that clearly and preserve
the next useful action: a blocked item, an enabler task for better source access,
or a concise note explaining why the resource is no longer worth pursuing.

## Constraints

- Do not infer content from URL shape, author, or surrounding context.
- Do not mark unread resources as researched, dismissed, or reference-only just
  because automated fetch failed.
- Do not create one task per URL unless a URL genuinely needs independent work.
- Keep disposition notes concise; avoid turning docs into a changelog.
- Prefer updating existing resource disposition docs/tasks over adding a new
  parallel tracking surface.

## Done When

- Current resource disposition docs and done research tasks have been checked
  for inaccessible, not-fetched, blocked, or dismissed source-access outcomes.
- Each unread-but-still-relevant resource is represented by an honest blocked
  state, follow-up task, or grouped enabler task.
- The X/Twitter links from the April 2026 research batch are no longer recorded
  as successfully dismissed research without a next action or explicit rationale.
- Any historical resource that remains terminal has a clear reason that does
  not pretend the unread content was processed.
