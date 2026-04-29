# Clients

This directory contains native client apps that connect to the KOTA daemon control API.

- Each client lives in its own subdirectory (e.g. `macos/`, `ios/`, `mobile/`).
- Clients are thin: all live state comes from the daemon HTTP+JSON API and SSE
  event stream. No client parses `.kota/` files or starts its own KOTA runtime.
- Authentication and daemon discovery must go through the client wrapper for
  that platform, not ad hoc view code.
- Clients are not modules. They do not contribute tools, workflows, channels, or agents.
- Native platform technology is preferred (SwiftUI for macOS/iOS, Kotlin/Jetpack Compose for Android, or a cross-platform framework when targeting multiple platforms).

## Clients

- `web/` — browser dashboard served by the daemon.
- `macos/` — native menu bar client.
- `mobile/` — mobile client.

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
3. `clients/macos/Tests/.../ContractFixtureTests.swift` — Swift
   decoders parse the same JSON tree (kept in lockstep by
   `src/contract-fixture-cross-client.integration.test.ts`).

Add a contract surface only after extending all three pieces in the
same change.

## Contract Migration Matrix

| Client    | Identity           | Capabilities       | Dashboard URL           | Workflow definitions      | Error envelope          |
|-----------|--------------------|--------------------|-------------------------|---------------------------|-------------------------|
| daemon (`/health`, etc.) | source of truth | source of truth | source of truth | source of truth | source of truth |
| CLI (`KotaClient`) | inferred via `DaemonControlClient.getIdentity()` | `getCapabilities()` (added) | n/a (no UI) | `getWorkflowDefinitions` | `parseDaemonClientErrorBody` (added) |
| web       | `api.getIdentity()` (added) | `api.getCapabilities()` (added) | n/a (is dashboard) | `api.getWorkflowDefinitions()` | typed via shared error body type |
| macOS     | `DaemonClient.fetchIdentity()` (added) | `DaemonClient.fetchCapabilities()` (added) | derived from `identity.dashboard.path` (no more `localhost:3000`) | `DaemonClient.fetchWorkflowDefinitions()` driving the trigger picker | `decodeDaemonErrorBody` (mirrors typed shape) |
| mobile (RN) | TBD — to consume `/identity` | TBD — to consume `/capabilities` | TBD — should use identity payload | TBD — picker not yet adopted | TBD — uses `daemonClient` typed errors |
| Telegram channel | TBD — channel does not currently fetch identity | TBD — graceful-degradation paths exist per route but no central readiness consumption | n/a | n/a (channel does not trigger workflows directly) | inherits daemon route error envelope |
| Slack channel | TBD | TBD | n/a | n/a | inherits daemon route error envelope |

The autonomous contract-promoter task is responsible for sweeping
"TBD" entries into the contract as additional client capacity comes
online.
