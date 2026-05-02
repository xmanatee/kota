---
id: task-update-macos-and-mobile-recall-empty-state-copy-to
title: Update macOS and mobile recall empty-state copy to include the answer source
status: ready
priority: p3
area: client
summary: Update macOS RecallView and mobile RecallScreen empty-state hints to enumerate the closed five-source contributor set (knowledge, memory, history, tasks, answer).
created_at: 2026-05-02T22:28:38.152Z
updated_at: 2026-05-02T22:28:38.152Z
---

## Problem

The daemon's `RecallSource` is closed over
`knowledge | memory | history | tasks | answer` — the answer-history
store is registered as a fifth recall contributor (commit `ca9b429a`,
2026-04-28). The macOS and mobile recall surfaces still show the pre-
fan-out four-source empty-state hint:

- `clients/macos/Sources/KotaMenuBar/RecallView.swift:39` — `"Type a
  query to recall across knowledge, memory, history, and tasks."`
- `clients/mobile/src/screens/RecallScreen.tsx:20` — `"Type a query
  and tap Search to recall across knowledge, memory, history, and
  tasks."`

The hint is the first thing an operator sees on an empty recall pane,
and it tells them which stores will be searched. Stating four when the
daemon now reaches five is operator-misleading, even though the actual
hits list (once a query is entered) reflects the real contributor set.

This is a small operator-cosmetic copy gap — distinct from the typed
decoder gap captured by `task-extend-cross-client-conformance-and-thin-
client-de` (which lands the `answer` arm into `RecallSource`,
`RecallHit`, the conformance fixture, and the per-client decoders).

## Desired Outcome

The macOS and mobile recall empty-state hints enumerate the closed
five-source contributor set so operator copy matches the daemon's
actual recall contributor set on every visual client surface.

## Constraints

- One canonical change per surface. Update the literal in each empty-
  state view; do not introduce a per-client constant catalog of source
  names just for the hint text.
- Do not duplicate `RECALL_SOURCE_ORDER` into the visual clients.
  The hint copy is operator-facing prose, not a typed decoder
  protocol.
- Land alongside or after `task-extend-cross-client-conformance-and-
  thin-client-de` so the decoder and the user copy reach the closed
  five-source set in coherent order. Out-of-order is acceptable
  (the copy update has no decoder dependency) but the post-condition
  must read coherently to operators.
- Web client is not in scope here — `clients/web/src/components/sidebar/
  RecallPanel.tsx` uses the placeholder `"Recall across stores..."`
  which is store-set-agnostic and stays correct regardless of
  contributor count.

## Done When

1. `clients/macos/Sources/KotaMenuBar/RecallView.swift` empty-state
   hint enumerates the five sources (`knowledge`, `memory`, `history`,
   `tasks`, `answer`).
2. `clients/mobile/src/screens/RecallScreen.tsx` empty-state hint
   enumerates the same five sources.
3. The matching tests (macOS XCTest snapshot or string assertion,
   mobile screen snapshot or string assertion) reflect the updated
   copy. Existing test runs go red with only the source-list change
   and green after the matching test update.
4. Operator-cosmetic verification: a screenshot of each surface's
   empty-state pane committed under the run directory or as a
   snapshot fixture.

## Source / Intent

Surfaced by the recall-fan-out consolidation review run
`.kota/runs/2026-05-02T22-17-31-479Z-builder-e794xy/recall-consolidation/`
(see `verdict.md` §6 "Stale legacy affordances"). The consolidation
flagged this as a small, operator-cosmetic copy gap distinct from the
typed-decoder gap already filed in
`task-extend-cross-client-conformance-and-thin-client-de`.

## Initiative

N/A - scoped maintenance.

## Acceptance Evidence

- Updated literals in `RecallView.swift` and `RecallScreen.tsx`
  committed alongside their matching test updates.
- Operator-captured screenshot of each surface's empty-state pane
  committed under `.kota/runs/<run-id>/` or as a snapshot fixture
  beside the test.
