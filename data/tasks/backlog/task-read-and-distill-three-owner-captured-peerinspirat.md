---
id: task-read-and-distill-three-owner-captured-peerinspirat
title: Read and distill three owner-captured peer/inspiration links
status: backlog
priority: p3
area: research
summary: Read harness-is-a-shell, garrytan tweet, and augmentcode AGENTS.md post; record per-link verdict (adopt/read/reject) per autonomy External Pattern Decisions convention.
created_at: 2026-04-25T12:09:31.366Z
updated_at: 2026-04-25T12:09:31.366Z
---

## Problem

The owner captured three peer/inspiration links to "go through and explore and
use for inspiration" but they are not periodic publishing surfaces, so they do
not belong on `data/watchlist.yaml`. Without an explicit research task they
risk drifting in inbox or being silently dropped. The three links are:

- https://inference.sh/blog/opinions/harness-is-a-shell — opinion piece on
  agent harness design philosophy.
- https://x.com/garrytan/status/2046876981711769720 — single tweet flagged as
  inspirational.
- https://www.augmentcode.com/blog/how-to-write-good-agents-dot-md-files —
  guidance on `AGENTS.md` authoring.

KOTA already has durable verdicts for harness design (autonomy module
`AGENTS.md`, "Core Autonomy Decisions" and "External Pattern Decisions") and
for `AGENTS.md` philosophy (root `AGENTS.md`, "Documentation"). Each link
should land as a concise verdict against those existing surfaces, not as new
parallel docs.

## Desired Outcome

Each of the three links is read against KOTA's existing decisions and produces
one of:

- A short verdict line under "External Pattern Decisions" or another existing
  autonomy/docs decision section (adopt / read / reject + which KOTA surface
  it touches), or
- An explicit "read, no action" note when nothing in KOTA changes.

If a link surfaces a concrete gap (a missing harness primitive, a missing
`AGENTS.md` convention), a follow-up normalized task is opened in
`data/tasks/backlog/`.

## Constraints

- Do not add the three links to `data/watchlist.yaml`. Watchlist is for
  durable peer agent runtimes and recurring research surfaces, not single
  blog posts or tweets (per `data/AGENTS.md`).
- Do not infer content from third-party summaries. If `x.com` or any other URL
  is auth-walled / 403, follow the inaccessible-source protocol in
  `data/tasks/AGENTS.md` (move to blocked or document why the source is no
  longer needed) rather than fabricating a verdict.
- Verdicts must be decision-focused and short, in line with the existing
  External Pattern Decisions style.

## Done When

- Each link has a verdict captured against an existing KOTA decision surface,
  or an explicit "read, no action" note.
- Any concrete KOTA gap surfaced becomes its own normalized backlog task.
- The original inbox capture is honestly accounted for: inaccessible sources
  are blocked, not silently dropped.

## Source / Intent

Owner inbox capture
`data/inbox/links-to-go-through-and-explore-and-use-for-inspiration.md`
(2026-04-25, verbatim title): "links to go through and explore and use for
inspiration". The three URLs above are the entire content of that capture.
Intent is owner-directed inspiration scouting, not roadmap delivery; verdicts
should fit existing decision surfaces rather than spawning a new doc.

## Initiative

N/A - scoped maintenance

## Acceptance Evidence

- `src/modules/autonomy/AGENTS.md` (or another existing decision surface)
  shows new short verdicts for the harness-is-a-shell post and the augmentcode
  AGENTS.md post, or explicit "read, no action" lines.
- The garrytan tweet has a recorded outcome (verdict, "read, no action", or a
  blocked-with-reason status if the tweet is no longer fetchable).
- Any spawned follow-up tasks are linked from the run artifact for this task.
