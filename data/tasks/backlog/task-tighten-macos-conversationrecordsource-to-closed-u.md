---
id: task-tighten-macos-conversationrecordsource-to-closed-u
title: Tighten macOS ConversationRecord.source to closed user|action set and add historySearch.negative_unknownSource conformance arm
status: backlog
priority: p3
area: client
summary: Make macOS HistoryModels.swift reject unknown ConversationRecord.source values and extend the cross-client conformance fixture with a historySearch.negative_unknownSource negative arm so drift is caught at the gate.
created_at: 2026-05-02T23:41:33.824Z
updated_at: 2026-05-02T23:41:33.824Z
---

## Problem

The daemon's `ConversationRecord.source` is a closed
`"user" | "action"` set (`src/core/modules/provider-types.ts:9-19`,
mirrored in `src/modules/history/routes.ts:19-21` and `:91-93` which
silently coerce unknown values to `undefined` at the URL boundary).
The mobile and conformance decoders enforce that closed set:

- `clients/mobile/src/daemon/history.ts:103-109` — rejects
  `obj.source` values that are not `'user'` or `'action'` by
  throwing `Invalid conversation record: unknown source ...`.
- `clients/conformance/decoders.ts:644-651` — `parseHistorySearchResponse`
  throws `unknown conversation source: ...` on the same set.

The macOS Swift mirror does not:

- `clients/macos/Sources/KotaMenuBar/Daemon/HistoryModels.swift:19`
  declares `let source: String?` — a permissive optional `String`
  that decodes any value silently.

The cross-client conformance fixture has no
`historySearch.negative_unknownSource` arm exercising the closed
`source` set on `ConversationRecord`. The
`historySearch.negative_unknownReason` arm is present but covers
only the top-level `reason` discriminator, not the nested
`ConversationRecord.source` field. The drift was therefore not
caught at fan-out time; the macOS HistoryView body does not display
`source` today, so the silently-accepted value is invisible to
operators, but the strict-decode discipline that every other fan-out
arm relies on is broken on this field.

## Desired Outcome

A daemon-emitted `historySearch` envelope whose
`conversations[].source` carries an unknown closed-set value (e.g.
`"system"`) is rejected at decode time on every visual surface
(macOS, mobile, web-relevant decoders). The cross-client conformance
gate has a `historySearch.negative_unknownSource` arm that
exercises this closed-set drift and fails the gate when any decoder
silently accepts the unknown value.

## Constraints

- Mirror the daemon's closed `"user" | "action"` set verbatim — no
  per-client renames, no third value, no coercion to `undefined`.
- Strict decode at the boundary. The negative arm in the conformance
  fixture must throw on every visual decoder.
- Do not change the daemon's existing silent-coerce behaviour at the
  URL boundary (`routes.ts:91-93` drops unknown query params to
  `undefined`); that is the operator-input boundary, not the
  daemon-emit boundary. The closed-set contract here is on the wire
  envelope the daemon emits and the visual surfaces decode, not the
  query param parsing.
- Do not introduce a per-surface fallback ("display unknown source as
  blank"); a future-source value is a contract bump and must surface
  as a typed decode failure.

## Done When

1. **macOS strict decode.** `clients/macos/Sources/KotaMenuBar/Daemon/
   HistoryModels.swift` decodes `ConversationRecord.source` through a
   closed `enum ConversationSource: String, Decodable { case user,
   action }` (or equivalent guarded `String` decode that throws on an
   unknown value). An XCTest case in
   `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift`
   exercises the negative arm and asserts the decode throws.
2. **Conformance fixture gains a negative-source arm.**
   `clients/conformance/contract-fixture.json` `historySearch` adds
   a `negative_unknownSource` row whose `conversations[0].source`
   carries an unknown value (e.g. `"system"`).
   `clients/conformance/decoders.test-cases.ts` adds the matching
   case with `expectThrow: true`.
3. **Web/mobile coverage holds.** The mobile Jest decoder suite
   (`clients/mobile/src/__tests__/`) and the web Vitest suite
   exercise the new fixture row through their `parseHistorySearch
   Response` paths and assert the throw.
4. **Negative arm is enforced.** Running `pnpm test` (or the
   per-client test suite, `swift test` for macOS) on a deliberately
   loosened decoder (e.g. macOS `let source: String?`) fails the
   negative arm — the gate must catch the drift, not paper over it.
5. **Docs reality check.** `src/modules/history/AGENTS.md` and any
   per-client local docs that name the closed `"user" | "action"`
   set are aligned with reality if they were drifting; otherwise
   confirm no docs touch is needed.

## Source / Intent

Surfaced by the `history` fan-out consolidation review on 2026-05-02
under `.kota/runs/2026-05-02T23-31-34-840Z-builder-2o6c4j/
history-consolidation/verdict.md` Section 2. The consolidation's
runtime probe pinned the daemon-side closed set; the cross-decoder
audit found that macOS silently accepts unknown source values while
mobile and conformance reject them. p3 because the affected field
is not displayed at the macOS HistoryView today, so the drift is
invisible to operators using the menu-bar surface — but the
conformance gate must catch the divergence so a future visible field
addition does not regress silently.

## Initiative

Cross-client wire-contract conformance: every fan-out should land
with strict-decode parity across visual surfaces, with the
conformance fixture as the single shared gate.

## Acceptance Evidence

- The new XCTest case in
  `clients/macos/Tests/KotaMenuBarTests/DaemonClientTests.swift`
  exercising the negative-source arm.
- The new `historySearch.negative_unknownSource` fixture row in
  `clients/conformance/contract-fixture.json` and the matching
  `expectThrow: true` case in
  `clients/conformance/decoders.test-cases.ts`.
- A run trace under `.kota/runs/<run-id>/` capturing
  `pnpm test` and `swift test` green with the new arm.
