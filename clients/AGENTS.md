# Clients

This directory contains native client apps that connect to the KOTA daemon control API.

- Each client lives in its own subdirectory (currently `web/`, `apple/`, and `mobile/`).
- Clients are thin: all live state comes from the daemon HTTP+JSON API and SSE
  event stream. No client parses `.kota/` files or starts its own KOTA runtime.
- Authentication and daemon discovery must go through the client wrapper for
  that platform, not ad hoc view code.
- Clients are not modules. They do not contribute tools, workflows, channels, or agents.
- Native platform technology is preferred (SwiftUI for macOS/iOS, Kotlin/Jetpack Compose for Android, or a cross-platform framework when targeting multiple platforms).

## Clients

- `web/` — browser dashboard served by the daemon.
- `apple/` — native macOS menu-bar app and native iOS app, sharing
  Swift sources (daemon transport, `AppState`, SwiftUI views) through
  a single Swift package with three targets (`KotaShared`,
  `KotaMenuBar`, `KotaiOS`).
- `mobile/` — React Native cross-platform mobile client. Android phone parity
  is its primary reason to exist while `apple/` owns native iOS. If a future
  decision makes React Native the canonical iOS app, that decision must first
  retire or rescope the native iOS shell so the repo does not keep two
  independent iOS product surfaces.

## Adding a New Client

- Create a subdirectory with an `AGENTS.md` that states ownership boundaries and
  durable platform conventions.
- Build against the daemon control API source and client wrapper types.
- Do not require any daemon or server changes — the existing API should be sufficient.
- If you discover a missing API capability, add a task to `data/inbox/` rather than patching the daemon from within the client.

## Thin-Client Contract

Every client must speak the same daemon control protocol. A new client
gets these affordances for free; an existing client must not invent
local equivalents.

- **Identity** — `GET /identity` returns the typed `ClientIdentity`
  payload (project name + absolute path, daemon version, pid, startedAt,
  dashboard availability). Clients must not derive identity from
  `.kota/` files; they must not collapse "wrong project" /
  "no control file" / "remote URL configured" into a single
  "Daemon offline" string.
- **Capability readiness** — `GET /capabilities` returns the typed
  `CapabilityReadinessResponse`. Each entry carries a stable id (e.g.
  `dashboard`, `knowledge.search`, `workflow.trigger`), a status
  (`ready` | `unavailable` | `init_failed`), an optional reason code,
  and a short operator-facing message. Clients must hide, disable, or
  explain controls whose capability is not `ready` rather than
  rendering an unhandled error after the route fails.
- **Dashboard URL** — clients must not hardcode `localhost:3000`. They
  must construct the dashboard URL from `ClientIdentity.dashboard.path`
  joined onto the daemon base URL (or remote URL), and they must hide
  the affordance entirely when `dashboard.available` is `false`.
- **Workflow definitions** — `GET /workflow/definitions` is the
  authoritative catalog. Workflow trigger UIs must consume this list
  rather than asking the operator for a free-text workflow name. The
  payload includes `inputSchema` when a workflow declares one; clients
  that cannot render input fields must surface that they are
  triggering without input.
- **Error envelope** — daemon error responses are JSON
  `{ "error"?, "code"?, "reason"?, "message"? }` (or plain text on
  pre-handler failures). The shared parser is
  `parseDaemonClientErrorBody` in `src/core/daemon/client-error.ts`;
  TypeScript clients consume that helper, and Swift clients mirror its
  field ordering through `DaemonErrorBody.displaySummary` so the same
  body renders the same line in every UI.
- **Presentation** — show the connected project + daemon identity in an
  unobtrusive way; render `unavailable` capabilities as "disabled with
  reason" rather than "broken with raw HTTP error"; never expose bearer
  tokens.

The contract conformance gate has three pieces:

1. `clients/conformance/contract-fixture.json` — canonical pinned
   sample of every contract surface.
2. `src/core/daemon/client-contract.test.ts` and
   `src/core/daemon/client-identity.test.ts` — TypeScript decoders
   exercise the fixture and the live `/identity` route.
3. `clients/apple/Tests/KotaSharedTests/ContractFixtureTests.swift` —
   Swift decoders parse the same JSON tree (kept in lockstep by
   `src/contract-fixture-cross-client.integration.test.ts`).

Add a contract surface only after extending all three pieces in the
same change.

Open client-contract gaps belong in `data/tasks/`, not in a durable
migration matrix. This file records the steady-state contract only.

## Platform Ownership

The steady state is one daemon protocol, multiple thin clients, and no duplicate
runtime ownership:

- `apple/` owns native macOS and native iOS behavior, including platform
  affordances that require AppKit/UIKit or SwiftUI-native shells.
- `mobile/` owns React Native shared mobile behavior and Android parity. It may
  share daemon-contract fixtures with other clients, but it must not add an
  iOS-only feature that bypasses or disagrees with `apple/`.
- Shared behavior belongs in the daemon contract or conformance fixtures, not in
  copy-pasted screen logic between `apple/` and `mobile/`.
