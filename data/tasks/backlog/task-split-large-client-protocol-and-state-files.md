---
id: task-split-large-client-protocol-and-state-files
title: Split large client protocol and state files
status: backlog
priority: p2
area: architecture
summary: Split oversized client files (mobile daemonClient, mobile types, macOS Models, macOS DaemonClient) by capability namespace or protocol area so each client stays thin, strict, and daemon-backed.
created_at: 2026-04-28T22:04:45.570Z
updated_at: 2026-04-28T22:04:45.570Z
---

## Problem

The 2026-04-28 broad daemon review found several client files have become
too large as seam fan-out accumulated:

- `clients/mobile/src/daemonClient.ts` is over 1,200 lines.
- `clients/mobile/src/types.ts` is over 800 lines.
- `clients/macos/Sources/KotaMenuBar/Models.swift` is about 1,400 lines.
- `clients/macos/Sources/KotaMenuBar/DaemonClient.swift` is over 600 lines.

These files concentrate every daemon namespace in a single module per
client, which makes future capture/recall/answer/retract-style fan-out more
expensive and more drift-prone.

## Desired Outcome

Each oversized client file is split by capability namespace or protocol area
so each piece is small, strict, and daemon-backed. The clients stay thin
(no business logic added) and decoders remain strict. Future protocol fan-
out can land per-namespace without touching unrelated code.

## Constraints

- Split by capability namespace or protocol area, not arbitrary line-count
  buckets.
- Keep each client thin and strict; do not introduce business logic during
  the split.
- Preserve existing strict decoding semantics: unknown enum values stay as
  typed failure arms.
- Coordinate with the cross-client wire-contracts task
  (`task-share-or-conformance-test-daemon-wire-contracts-ac`); do not
  pre-empt or contradict that mechanism.
- Do not create a parallel public surface; the split is internal layout
  within each client.

## Done When

- Each listed client file is split into smaller per-namespace or per-area
  modules following the chosen split shape.
- No file in the affected directories exceeds the language's file-size
  budget without a documented reason.
- All existing client tests still pass after the split.
- The split shape is documented in scoped `AGENTS.md` for each affected
  client tree.

## Source / Intent

2026-04-28 broad daemon review (verbatim): "several client files that have
become too large as seam fan-out accumulated. Examples:
clients/mobile/src/daemonClient.ts is over 1,200 lines.
clients/mobile/src/types.ts is over 800 lines.
clients/macos/Sources/KotaMenuBar/Models.swift is about 1,400 lines.
clients/macos/Sources/KotaMenuBar/DaemonClient.swift is over 600 lines.
Desired outcome: Split these by capability namespace or protocol area while
keeping each client thin, strict, and daemon-backed. This should make
future capture/recall/answer/retract-style fan-out cheaper and less
drift-prone."

## Initiative

Client architecture: keep mobile and macOS clients small, strict, and
daemon-backed as the daemon protocol grows, so per-namespace fan-out lands
locally instead of editing 1k-line monoliths.

## Acceptance Evidence

- A diff or post-split tree summary showing per-client file inventories
  before and after, recorded in a run-directory artifact.
- All client test suites green after the split (mobile + macOS).
- Updated `AGENTS.md` files describing the namespace split shape for the
  mobile and macOS clients.
