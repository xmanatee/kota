---
id: task-tighten-acceptance-evidence-for-client-and-channel
title: Tighten acceptance evidence for client and channel fan-out
status: backlog
priority: p2
area: architecture
summary: Define a lightweight standard for client/channel fan-out tasks that requires at least one rendered-output artifact, screenshot, CLI transcript, or shared fixture per user-facing surface when visible behavior changes, without creating a parallel changelog or audit surface.
created_at: 2026-04-28T22:04:50.721Z
updated_at: 2026-04-28T22:04:50.721Z
---

## Problem

Recent commits added broad web/mobile/macOS/Telegram/Slack fan-out. Tests are
strong, but acceptance evidence often lives in unit tests instead of
rendered or operator-visible artifacts. This makes user-visible regressions
harder to catch on review and gives autonomy a soft path to claim "done"
without producing the visible artifact a human operator would actually
inspect.

## Desired Outcome

A short, repo-wide standard for what counts as acceptance evidence on
client/channel fan-out tasks: at least one rendered-output artifact,
screenshot, CLI transcript, or shared fixture per user-facing surface
whenever the change affects visible behavior. The standard is enforceable
through validation (the existing `## Acceptance Evidence` section) without
adding a new changelog, audit, or report directory.

## Constraints

- Do not add a parallel changelog or audit surface. The standard lives in
  scoped `AGENTS.md` and the existing `## Acceptance Evidence` section.
- Keep the rule narrow: it applies to client/channel fan-out tasks where
  the change affects user-facing behavior. Internal-only refactors are
  exempt.
- Prefer evidence types the repo already produces (`.kota/runs/` artifacts,
  rendered transcripts, fixtures) over new artifact kinds.
- Validation enforcement should fail loudly on missing rendered evidence
  for tasks the rule applies to, but must not over-fire on internal work.

## Done When

- The standard is documented in the appropriate `AGENTS.md` (likely
  `data/tasks/AGENTS.md` and any client/channel module trees that own
  fan-out tasks).
- Existing task validation either already enforces the standard or is
  extended to enforce it for matching tasks, with a clear scope so it does
  not over-fire on internal refactors.
- The validator's behavior is demonstrated against a fixture task that
  fails the rule and one that satisfies it.

## Source / Intent

2026-04-28 broad daemon review (verbatim): "Recent commits added broad
web/mobile/macOS/Telegram/Slack fan-out. Tests are strong, but acceptance
evidence often lives in unit tests instead of rendered/operator-visible
artifacts. Desired outcome: Define a lightweight standard for
client/channel fan-out tasks: at least one rendered-output artifact,
screenshot, CLI transcript, or shared fixture per user-facing surface when
the task changes visible behavior. Keep this narrow; do not create a
parallel changelog or audit surface."

## Initiative

Operator-visible quality: align acceptance evidence on fan-out tasks with
what an operator would actually inspect, so visible regressions surface in
review rather than after merge.

## Acceptance Evidence

- An `AGENTS.md` update documenting the standard and its scope.
- A validator change (or confirmation that current validation already
  covers it) plus fixture tasks demonstrating both passing and failing
  cases under the rule.
