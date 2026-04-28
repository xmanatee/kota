---
id: task-share-or-conformance-test-daemon-wire-contracts-ac
title: Share or conformance-test daemon wire contracts across clients
status: backlog
priority: p1
area: architecture
summary: Define one durable way to share, generate, or conformance-test daemon wire contracts across web, mobile, and macOS clients so protocol drift is caught mechanically rather than discovered by manually comparing duplicated types.
created_at: 2026-04-28T22:04:30.330Z
updated_at: 2026-04-28T22:04:30.330Z
---

## Problem

The 2026-04-28 broad daemon review found strong client test coverage, but
web, mobile, and macOS all hand-maintain daemon response types and decoders.
The mirroring lives in:

- `clients/web/src/api/types.ts`
- `clients/mobile/src/daemonClient.ts` and `clients/mobile/src/types.ts`
- `clients/macos/Sources/KotaMenuBar/Models.swift`

Today's per-client tests catch drift after the fact, but the contract is not
robust by construction. There is also no single check that proves all clients
agree with the daemon protocol for shared surfaces (recall, answer,
answer-history, capture, retract, semantic search, attention, digest, voice).

## Desired Outcome

One durable mechanism — code-generation, shared schema, fixture-corpus
conformance, or contract test suite — that prevents silent client drift from
the daemon protocol. When a daemon response shape changes, the client side
fails mechanically rather than at the next manual comparison. Strict decoding
and typed failure arms (unknown reason/source/target) are preserved, including
through negative fixtures.

## Constraints

- Pick one mechanism. Do not add a second public API surface alongside the
  existing daemon control protocol.
- Preserve strict decoding: unknown enum values must remain typed failure
  arms, not silent passes.
- Cover representative shared surfaces: recall, answer, answer-history,
  capture, retract, semantic search, attention, digest, voice. Include
  negative fixtures for unknown reason/source/target values.
- Web, mobile, and macOS must all participate; partial coverage is not
  acceptable for the chosen mechanism.
- Do not regress existing per-client tests; this mechanism replaces or
  augments them, but the strict-decoding guarantees stay.

## Done When

- A single mechanism exists in the repo for cross-client daemon-contract
  conformance, documented in scoped `AGENTS.md` where the contracts live.
- All three clients (web, mobile, macOS) participate in that mechanism for
  the listed daemon response surfaces, including negative fixtures.
- Changing a daemon response shape without updating the corresponding client
  decoder fails the conformance check (verified by an artifact showing a
  deliberate breakage and the resulting failure).
- No second public API surface is introduced.

## Source / Intent

2026-04-28 broad daemon review (verbatim, contract-sharing): "all mirror
daemon protocol shapes manually. Tests catch drift after the fact, but the
contract is not robust by construction. Desired outcome: Define one durable
way to share, generate, or conformance-test daemon wire contracts across web,
mobile, and macOS. Preserve strict decoding and typed failure arms. Do not
add a second public API surface."

2026-04-28 broad daemon review (verbatim, drift checks): "good per-client
tests, but no single check that proves all clients agree with the daemon
protocol for shared surfaces... Add fixture payloads for key daemon
responses... Make web/mobile/macOS decode the same fixture corpus, or
generate a report proving each client has coverage for every daemon response
arm. Include negative fixtures for unknown reason/source/target values so
strict decoding stays intentional."

These were two angles on the same problem in the original captures. The
fixture-corpus conformance approach is one valid implementation of the
durable wire-contract sharing mechanism; this task picks one solution rather
than tracking the angles separately.

## Initiative

Make daemon ↔ client protocol drift impossible by construction so
capture/recall/answer/retract-style fan-out across web, mobile, and macOS
stays cheap and safe as the protocol grows.

## Acceptance Evidence

- A run-directory or repo artifact showing the chosen mechanism in action:
  the conformance check passing on current `main`, and a deliberate daemon
  shape breakage causing the same check to fail in all three clients.
- Documentation at the scoped `AGENTS.md` for the owning surface explaining
  how clients participate and how negative fixtures are added.
