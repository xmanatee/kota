---
id: task-map-a2a-tenant-routing-to-kota-project-scoping
title: Map A2A tenant routing to KOTA project scoping
status: done
priority: p2
area: modules
summary: Teach the A2A channel to advertise and decode v1.0 tenant routing for project-scoped sessions instead of relying only on KOTA-specific projectId metadata.
created_at: 2026-05-27T12:09:36.215Z
updated_at: 2026-05-27T12:24:19.000Z
---

## Problem

KOTA's A2A channel is already project-aware, but the external protocol shape is
not. `src/modules/a2a-channel/protocol.ts` currently accepts KOTA-specific
`projectId` values from params or metadata, and
`src/modules/a2a-channel/daemon-session-client.ts` maps those values to daemon
`/sessions?projectId=...` calls. The Agent Card's `supportedInterfaces` entry
does not advertise an A2A `tenant` value, so a generic A2A client has no
protocol-native way to discover or echo KOTA's project routing key.

The A2A v1.0 multi-tenancy guidance now calls out exactly this deployment
shape: one endpoint may serve multiple tenants or agents, and the
`AgentInterface.tenant` field is the body-based routing key clients must echo
when it is advertised. Leaving KOTA's project scope as only `projectId`
metadata makes the A2A surface less interoperable and leaves routing behavior
split between protocol fields and KOTA-only metadata.

## Desired Outcome

The A2A channel uses v1.0 tenant routing as the canonical external project
scope for A2A requests. A project-scoped KOTA Agent Card advertises the
selected project through `supportedInterfaces[].tenant`, and every supported
A2A request path decodes that tenant value once at the module boundary before
calling daemon/session primitives with an internal `projectId`.

Unscoped Agent Cards remain honest: if no tenant is advertised, A2A requests
must omit tenant and route only to the default/unscoped behavior KOTA
intentionally exposes.

## Constraints

- Keep the work inside `src/modules/a2a-channel/` unless an existing daemon
  client type must be extended. Do not add a parallel project registry, session
  store, task store, or A2A routing layer.
- Treat `tenant`, `projectId`, message metadata, and context ids as external
  input. Decode and normalize once at the A2A boundary.
- If a request carries both A2A tenant and legacy/KOTA-specific project
  metadata, reject mismatches instead of silently preferring one routing key.
- Public Agent Cards must not leak sensitive deployment details. Put any
  project-specific card expansion behind the existing bearer-protected extended
  card route or another explicitly protected A2A route.
- Do not use this task to implement A2A push notifications, registries, MCP
  mirroring, or Agent Card signatures.
- Keep exact A2A field names and error details in source types and focused
  tests, not durable docs catalogs.

## Done When

- `A2AAgentCard.supportedInterfaces` can represent an optional v1.0 `tenant`
  value, and project-scoped Agent Cards advertise the tenant that clients must
  echo.
- `SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`,
  and `SubscribeToTask` all use the same normalized A2A tenant-to-project
  routing path.
- Requests with no advertised tenant stay unscoped. Requests with a mismatched
  tenant/projectId pair fail before daemon session work starts with a typed A2A
  error.
- Existing KOTA project filtering still works for daemon-backed A2A sessions,
  but the external contract no longer depends only on KOTA-specific
  `projectId` metadata.
- Focused A2A tests cover Agent Card tenant advertisement, unscoped cards,
  matching tenant routing, mismatched tenant rejection, list/get filtering,
  and streaming failure before backend work on routing mismatch.

## Source / Intent

Explorer run `2026-05-27T12-06-39-206Z-explorer-ulhooh` found the actionable
queue empty: zero ready tasks, zero doing tasks, and two backlog research tasks
waiting on `task-enable-autonomous-access-to-auth-walled-sources-so`. The
strategic blocked alternatives all still require operator-captured artifacts
and were not movable, so a nonduplicative A2A protocol-fidelity slice is a
better next ready task than a noop or client fan-out work.

Primary sources checked:

- https://a2a-protocol.org/latest/topics/multi-tenancy/ describes A2A
  multi-tenancy and multi-agent routing, including URL-prefix routing,
  auth-header routing, and body-based routing using the `tenant` field.
- https://a2a-protocol.org/latest/specification/ defines
  `AgentInterface.tenant` as an optional opaque routing value and says clients
  must include the advertised value in request messages.

Local evidence:

- `src/modules/a2a-channel/agent-card.ts` advertises a single JSON-RPC
  `supportedInterfaces` entry with URL and protocol version, but no tenant.
- `src/modules/a2a-channel/protocol.ts` decodes `projectId` from params or
  metadata for sends, selectors, and list filters.
- `src/modules/a2a-channel/daemon-session-client.ts` already maps that internal
  project scope to daemon session creation and filtering.
- Existing A2A tests cover project filtering through `projectId`, but no test
  asserts v1.0 tenant advertisement or tenant/projectId mismatch handling.

## Initiative

A2A protocol fidelity through module-owned channels.

## Acceptance Evidence

- `pnpm test src/modules/a2a-channel`
- `pnpm run typecheck`
- `pnpm exec biome check src/modules/a2a-channel`
- A protocol transcript under `.kota/runs/<run-id>/` showing a project-scoped
  Agent Card with `tenant`, one accepted request routed to that KOTA project,
  and one mismatched tenant/projectId request rejected before daemon work.
