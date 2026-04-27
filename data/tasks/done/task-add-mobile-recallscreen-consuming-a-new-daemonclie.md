---
id: task-add-mobile-recallscreen-consuming-a-new-daemonclie
title: Add mobile RecallScreen consuming a new DaemonClient.recall
status: done
priority: p2
area: client
summary: Add a RecallScreen in the mobile client that calls POST /recall through a new DaemonClient.recall, exposes recall state on DaemonContext, and renders the four discriminated RecallHit arms (knowledge/memory/history/task) with source + score badges, closing the cross-store-recall fan-out across Telegram, daemon HTTP, web, macOS DaemonClient, macOS RecallView, and mobile.
created_at: 2026-04-27T10:00:19.077Z
updated_at: 2026-04-27T10:14:02.308Z
---

## Problem

The cross-store recall seam is now reachable from the CLI
(`kota recall <query>`), the daemon control server (`POST /recall`),
the user-facing HTTP server (`POST /api/recall`), Telegram (`/recall`),
the web client (`RecallPanel` consuming `/api/recall`), and the macOS
menu bar (`DaemonClient.recall` + `RecallView`, commits `559d9eed` and
`b7ea172b`). Mobile is the only registered operator surface that still
has no way to issue a unified recall query — the existing mobile
screens (`HistoryScreen`, `MemoryScreen`, `KnowledgeScreen`,
`TaskSearchScreen`) each hit one store at a time, with no way to ask
the same question across all four. This is the same cross-surface gap
the recall seam was built to close, and mobile is the final fan-out
step before the cadence Telegram → CLI → daemon → web → macOS →
mobile is complete for cross-store recall.

## Desired Outcome

The mobile client gains a `RecallScreen` — a navigation-mounted screen
mirroring the shape of `HistoryScreen` / `MemoryScreen` /
`KnowledgeScreen` / `TaskSearchScreen` — with a query input, a submit
affordance, and a result list that renders all four `RecallHit` arms
(`knowledge`, `memory`, `history`, `task`) with a clear source badge
per row and the normalized `[0, 1]` score, preserving the existing
`RECALL_SOURCE_ORDER` tertiary sort tie-break.

The mobile `DaemonClient` gains a `recall(query, options)` method that
calls `POST /api/recall` and returns the same discriminated
`{ ok: true, hits: RecallHit[] } | { ok: false, reason: "semantic_unavailable" }`
envelope the macOS `DaemonClient.recall` already returns, rejecting
other shapes loudly. `DaemonContext` exposes `recallQuery`,
`recallResult`, `recallLoading`, `recallError`, and `recall(query)`
matching the per-store fan-out shape, with reducer coverage on the
new actions.

The four operator-visible branches surface one-to-one with the daemon
contract:

- Per-hit ranked rows for non-empty results with a source badge per
  row (knowledge / memory / history / task) and the normalized score.
- A fixed empty-result body so the operator can distinguish "nothing
  matched" from "command failed".
- A whitespace-only / empty-query inline usage hint that skips the
  request.
- An `ok: false, reason: "semantic_unavailable"` notice surfaced
  explicitly — never a silent degrade to per-store keyword search.

## Constraints

- Build on the existing `DaemonContext`, navigation map, mobile
  `DaemonClient`, and screen composition. Do not add a parallel state
  container, navigation stack, or HTTP client just for recall.
- Reuse the same daemon HTTP route the web client consumes
  (`POST /api/recall`). Do not introduce a second recall route,
  response shape, or rendering helper on the mobile side.
- Mirror the macOS `DaemonClient.recall` decode discipline: same
  discriminated envelope, same loud rejection of unknown reasons /
  malformed hits, same source-tagged `RecallHit` arms.
- Match the per-store screen interaction discipline (pull-to-refresh
  re-runs the last query, explicit loading / error / empty / quiet
  states, no eager fetch when the daemon is offline).
- Keep `RecallScreen` visually consistent with the four sibling
  pull-surfaces so the family feels uniform.
- Respect the typed mobile reducer state
  (`clients/mobile/src/context/state.ts`); add coverage for the new
  reducer actions rather than relaxing existing assertions.
- Do not duplicate the per-hit line shape. Either share the existing
  recall rendering helper across the language boundary by re-deriving
  the same line format from the typed hits on the mobile side, or
  factor a small typed renderer that both surfaces can call —
  whichever produces fewer moving parts. No third format.
- Single new screen + new `DaemonClient.recall` method + reducer +
  navigation edit. Do not refactor the four sibling screens in this
  task.

## Done When

- `clients/mobile/src/screens/RecallScreen.tsx` renders the
  `RecallScreen`, registered in the navigation map and reachable
  alongside `HistoryScreen`, `MemoryScreen`, `KnowledgeScreen`,
  `TaskSearchScreen`.
- The mobile `DaemonClient` adds a `recall(query, options)` method
  against `POST /api/recall`, returning the same discriminated
  envelope as the macOS / web surfaces, with a typed mirror in
  `clients/mobile/src/types.ts`.
- `DaemonContext` exposes `recallQuery`, `recallResult`,
  `recallLoading`, `recallError`, and `recall(query)`, matching the
  knowledge/memory/history/tasks fan-out shape, with reducer coverage
  in `clients/mobile/src/__tests__/reducer.test.ts`.
- `clients/mobile/src/__tests__/RecallScreen.test.tsx` covers the
  populated-results state across at least two source arms, the
  empty-results state, the empty-query usage hint, the
  `semantic_unavailable` branch, and the error state.
- `clients/mobile/src/__tests__/daemonClient.test.ts` adds the same
  recall-success / semantic-unavailable / unknown-reason /
  malformed-hit / HTTP-error coverage already in place for
  `searchKnowledge`, `searchMemory`, `searchHistory`, `searchTasks`.
- The mobile test command and the recall module's tests both pass
  cleanly; no other recall fan-out tests regress.

## Source / Intent

Closing the multi-surface fan-out kicked off by the cross-store recall
seam (commit `09d60ce3`) and continued through Telegram (`6510f998`),
the web `RecallPanel` (`9a96682a`), the macOS `DaemonClient.recall`
(`559d9eed`), and the macOS `RecallView` (`b7ea172b`). The macOS
`RecallView` task explicitly named "mobile `RecallScreen` is a
separate follow-up" as the remaining surface. The mobile `searchTasks`
fan-out (commit `18ba6edf`) established the same Telegram → CLI →
daemon → macOS → mobile cadence the digest, attention, knowledge,
memory, history, and tasks-semantic seams already follow; this task is
the final mobile-side fan-out for the cross-store recall surface.

## Initiative

Cross-store recall surface fan-out — give every operator surface
(Telegram, CLI, daemon HTTP, web, macOS, mobile) one unified search
across knowledge / memory / history / tasks instead of per-store
queries. With this task done, the recall seam reaches the same
multi-client parity the digest, attention, knowledge, memory, history,
and tasks-semantic seams already have, and an operator on a phone
gains direct access to unified cross-store recall without
context-switching to another client.

## Acceptance Evidence

- Mobile test command output showing the new `RecallScreen` reducer,
  navigation, and daemon-client tests passing.
- A screenshot or transcript of the mobile `RecallScreen` showing the
  populated-results state with hits across at least two source arms,
  the empty-results state, the empty-query usage hint, and the
  `semantic_unavailable` notice driven by the same daemon route.
- A short rendered-output sample (line shape) from the
  `RecallScreen` next to the equivalent `kota recall` CLI output and
  the Telegram `/recall` body proving line-shape parity.
