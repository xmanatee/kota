---
id: task-add-mobile-answerscreen-consuming-daemonclientansw
title: Add mobile AnswerScreen consuming DaemonClient.answer
status: ready
priority: p2
area: client
summary: Add an AnswerScreen in the mobile client that calls POST /api/answer through a new DaemonClient.answer, exposes answer state on DaemonContext, and renders the synthesized answer body plus typed citations across the four source arms (knowledge/memory/history/tasks), closing the cited-answer fan-out across CLI, daemon HTTP, Telegram, web, macOS DaemonClient, macOS AnswerView, and mobile.
created_at: 2026-04-27T14:29:49.669Z
updated_at: 2026-04-27T14:29:49.669Z
---

## Problem

The cited-answer seam is now reachable from the CLI (`kota answer`),
the daemon control server (`POST /answer`), the user-facing HTTP twin
(`POST /api/answer`), Telegram (`/answer`, commit `82a544af`), the web
client (`AnswerPanel`, commit `1d3dcefb`), and the macOS menu bar
(`DaemonClient.answer` in commit `647ddb85` plus `AnswerView` in commit
`70308aab`). Mobile is the only registered operator surface that still
has no way to ask one question and get one synthesized answer plus
typed citations into the second brain — the existing mobile
`RecallScreen` (commit `eca5b01a`) gives unified ranked hits, but
there is no mobile surface that turns those hits into one composed
answer with `[source:id]` citations. This is the same cross-surface
gap the cited-answer seam was built to close, and mobile is the final
fan-out step before the cadence Telegram → CLI → daemon → web →
macOS → mobile is complete for cited answers.

## Desired Outcome

The mobile client gains an `AnswerScreen` — a navigation-mounted
screen mirroring the shape of `RecallScreen` /
`HistoryScreen` / `MemoryScreen` / `KnowledgeScreen` /
`TaskSearchScreen` — with a query input, a submit affordance, the
synthesized answer body rendered verbatim (preserving inline
`[source:id]` markers), and a per-citation list below it with one
source badge per row matching the source-tint mapping the mobile
`RecallScreen` already uses (`knowledge`→blue, `memory`→purple,
`history`→green, `tasks`→orange) so the cited-answer surface stays
visually consistent with the recall surface and with the web
`AnswerPanel` and the macOS `AnswerView`.

The mobile `DaemonClient` gains an `answer(query, options)` method
that calls `POST /api/answer` and returns the same four-arm
discriminated envelope the macOS `DaemonClient.answer` already
returns:

- `{ ok: true, answer: string, citations: AnswerCitation[] }`
- `{ ok: false, reason: "no_hits" }`
- `{ ok: false, reason: "semantic_unavailable" }`
- `{ ok: false, reason: "synthesis_failed" }`

It rejects other shapes loudly. `DaemonContext` exposes `answerQuery`,
`answerResult`, `answerLoading`, `answerError`, and `answer(query)`
matching the per-store fan-out shape, with reducer coverage on the
new actions.

The four operator-visible branches surface one-to-one with the daemon
contract:

- A composed answer body plus a per-citation list with one source
  badge per row for the success arm.
- A fixed `no_hits` body so the operator can distinguish "nothing
  matched" from "command failed".
- A `semantic_unavailable` notice surfaced explicitly — never a
  silent degrade to per-store keyword search.
- A `synthesis_failed` notice surfaced explicitly — never a thrown
  error.

A whitespace-only / empty-query inline usage hint skips the request,
mirroring the mobile `RecallScreen` behavior.

## Constraints

- Build on the existing `DaemonContext`, navigation map, mobile
  `DaemonClient`, and screen composition. Do not add a parallel state
  container, navigation stack, or HTTP client just for the answer
  surface.
- Reuse the same daemon HTTP route the web client and Telegram
  consume (`POST /api/answer`). Do not introduce a second answer
  route, response shape, or rendering helper on the mobile side.
- Mirror the macOS `DaemonClient.answer` decode discipline: same
  four-arm discriminated envelope, same loud rejection of unknown
  reasons or malformed citations, same source-tagged
  `AnswerCitation` shape.
- Reuse the mobile recall source-tint mapping (or factor it into one
  shared mobile-side helper if both screens benefit) rather than
  forking a parallel four-source color map. No third source-tint
  table.
- Render the answer body verbatim — preserving inline `[source:id]`
  markers from the synthesis output — instead of stripping or
  re-formatting them. The citation list is rendered alongside the
  body, not inlined into it.
- Match the per-store screen interaction discipline (pull-to-refresh
  re-runs the last query, explicit loading / error / empty / quiet
  states, no eager fetch when the daemon is offline).
- Keep `AnswerScreen` visually consistent with the five sibling
  pull-surfaces so the family feels uniform.
- Respect the typed mobile reducer state
  (`clients/mobile/src/context/state.ts`); add coverage for the new
  reducer actions rather than relaxing existing assertions.
- Single new screen + new `DaemonClient.answer` method + reducer +
  navigation edit. Do not refactor the five sibling screens in this
  task.
- No web/Telegram/CLI/macOS changes in this task — those surfaces are
  already landed.

## Done When

- `clients/mobile/src/screens/AnswerScreen.tsx` renders the
  `AnswerScreen`, registered in the navigation map and reachable
  alongside `RecallScreen`, `HistoryScreen`, `MemoryScreen`,
  `KnowledgeScreen`, `TaskSearchScreen`.
- The mobile `DaemonClient` adds an `answer(query, options)` method
  against `POST /api/answer`, returning the same four-arm
  discriminated envelope as the macOS / web surfaces, with a typed
  mirror in `clients/mobile/src/types.ts` for the `AnswerResult` and
  `AnswerCitation` shapes.
- `DaemonContext` exposes `answerQuery`, `answerResult`,
  `answerLoading`, `answerError`, and `answer(query)`, matching the
  knowledge/memory/history/tasks/recall fan-out shape, with reducer
  coverage in `clients/mobile/src/__tests__/reducer.test.ts`.
- `clients/mobile/src/__tests__/AnswerScreen.test.tsx` covers the
  populated-success state with citations across at least two source
  arms, the `no_hits` notice, the `semantic_unavailable` notice, the
  `synthesis_failed` notice, the empty-query usage hint, and the
  network-error state.
- `clients/mobile/src/__tests__/daemonClient.test.ts` adds the same
  answer-success / no-hits / semantic-unavailable / synthesis-failed
  / unknown-reason / malformed-citation / HTTP-error coverage already
  in place for `recall` and the per-store searches.
- The mobile test command and the answer module's tests both pass
  cleanly; no other answer or recall fan-out tests regress.

## Source / Intent

Closing the multi-surface fan-out kicked off by the cited-answer
seam (commit `082c565f`) and continued through Telegram (`82a544af`),
the web `AnswerPanel` (`1d3dcefb`), the macOS `DaemonClient.answer`
(`647ddb85`), and the macOS `AnswerView` (`70308aab`). The macOS
`AnswerView` task explicitly named "mobile `AnswerScreen` is a
separate follow-up" as the remaining surface. The mobile
`RecallScreen` fan-out (commit `eca5b01a`) established the same
Telegram → CLI → daemon → web → macOS → mobile cadence the digest,
attention, knowledge, memory, history, tasks-semantic, and recall
seams already follow; this task is the final mobile-side fan-out for
the cited-answer surface.

## Initiative

Personal-assistant answering. KOTA should answer one operator query
with one short composed answer plus typed citations into the second
brain on every operator surface, not just the CLI, daemon, Telegram,
web, and macOS. The mobile client is the natural sixth and final
surface — the same place the operator already runs `/recall` from
`RecallScreen` — and closes the cited-answer fan-out so an operator
on a phone gains direct access to the synthesized-answer surface
without context-switching to another client.

## Acceptance Evidence

- Mobile test command output showing the new `AnswerScreen` reducer,
  navigation, and daemon-client tests passing.
- A screenshot or transcript of the mobile `AnswerScreen` showing the
  populated-success state with citations spanning at least two
  source arms for a real query, plus the `no_hits` /
  `semantic_unavailable` / `synthesis_failed` notice rendered when
  the daemon responds with `ok: false`, plus the empty-query usage
  hint.
- A short rendered-output sample (line shape) from the
  `AnswerScreen` next to the equivalent macOS `AnswerView` body and
  the Telegram `/answer` reply proving line-shape parity for the
  answer body and the per-citation rows.
