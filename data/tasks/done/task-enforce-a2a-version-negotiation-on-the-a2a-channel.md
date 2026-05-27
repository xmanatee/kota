---
id: task-enforce-a2a-version-negotiation-on-the-a2a-channel
title: Enforce A2A version negotiation on the A2A channel
status: done
priority: p2
area: modules
summary: The A2A channel advertises protocolVersion 1.0 but does not validate A2A-Version requests or return VersionNotSupportedError before daemon work; make version negotiation explicit at the module boundary.
created_at: 2026-05-27T07:33:34.400Z
updated_at: 2026-05-27T07:45:19.752Z
---

## Problem

KOTA's A2A channel now exposes a v1.0 Agent Card and a protected JSON-RPC
endpoint, but the route does not inspect the client-requested A2A protocol
version. `src/modules/a2a-channel/agent-card.ts` advertises
`supportedInterfaces[0].protocolVersion: "1.0"`, while
`src/modules/a2a-channel/routes.ts` dispatches every RPC without checking the
`A2A-Version` header or returning the v1.0 `VersionNotSupportedError` shape.

The A2A v1.0 spec says clients send `A2A-Version`, empty values are interpreted
as v0.3, and servers process requests using the requested major/minor semantics
or reject unsupported versions. Silently running KOTA's v1.0 decoder for an
unknown, missing, or legacy version makes protocol drift hard to diagnose and
can call daemon session APIs before the channel has proven the request belongs
to a supported A2A contract.

## Desired Outcome

The A2A channel has one explicit version-negotiation boundary. Requests that
select v1.0 continue through the existing v1.0 decoder and daemon-backed
session flow. Requests that select any unsupported version, including the
spec's empty-header v0.3 interpretation unless KOTA intentionally implements
v0.3 compatibility, fail before backend/session work with a typed A2A
version-not-supported error that names the requested version and KOTA's
supported versions.

## Constraints

- Keep the behavior inside `src/modules/a2a-channel/`; this is protocol-route
  validation, not a new core daemon primitive.
- Keep the Agent Card honest. If KOTA only supports v1.0, advertise only v1.0
  interfaces and reject other requested versions. Add a v0.3 interface only if
  a real v0.3 compatibility path exists.
- Decode version selection from A2A's transport boundary, not from free-form
  metadata that reaches the daemon session layer.
- Streaming calls must fail as protocol results without opening a long-lived
  daemon stream or sending partial task updates.
- Preserve existing auth and unsupported-capability behavior. Version
  validation must not create an unauthenticated route around the protected RPC
  endpoint.
- Keep exact method names, error reason strings, and header/parameter handling
  in focused code and tests, not in durable docs catalogs.

## Done When

- The A2A RPC route accepts v1.0 requests through the header and any
  spec-supported request-parameter path KOTA chooses to expose.
- Unsupported versions fail before `backendFactory()` or daemon transport work
  starts, including legacy/missing version handling if KOTA does not implement
  v0.3.
- The JSON-RPC error uses a precise A2A `VERSION_NOT_SUPPORTED` /
  `VersionNotSupportedError` mapping with structured `google.rpc.ErrorInfo`
  data and supported-version metadata.
- `SendStreamingMessage` and `SubscribeToTask` emit exactly one SSE-framed
  version error and close when the requested version is unsupported.
- The public and extended Agent Cards remain internally consistent with the
  accepted version set.
- Focused tests cover accepted v1.0, unsupported explicit versions, missing or
  empty version handling, streaming failure before backend work, and no daemon
  calls on version mismatch.

## Source / Intent

Explorer run `2026-05-27T07-29-36-209Z-explorer-yhyup3` refreshed the new
A2A watchlist entry while the actionable queue was empty. The strategic
blocked alternatives all still require operator-captured artifacts, so this
nonduplicative protocol-fidelity slice is the right ready task.

Relevant local state:

- `data/tasks/done/task-expose-kota-sessions-through-an-a2a-agent-channel.md`
  completed KOTA's first A2A channel slice.
- `src/modules/a2a-channel/agent-card.ts` advertises a JSON-RPC
  `supportedInterfaces` entry with protocol version `1.0`.
- `src/modules/a2a-channel/routes.ts` dispatches `SendMessage`,
  `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, and
  `SubscribeToTask` without inspecting `A2A-Version`.
- `src/modules/a2a-channel/routes.test.ts` covers JSON-RPC success,
  streaming, auth, bad params, and unsupported methods, but has no version
  negotiation assertions.

Primary sources:

- https://a2a-protocol.org/latest/announcing-1.0/ - A2A v1.0 is the stable
  production-ready release and emphasizes version negotiation across bindings.
- https://a2a-protocol.org/latest/specification/ - A2A v1.0 defines
  `supportedInterfaces[].protocolVersion`, the `A2A-Version` header,
  unsupported-version behavior, JSON-RPC/HTTP error shapes, and IANA
  registration for the version header.
- https://a2a-protocol.org/latest/whats-new-v1/ - migration guidance calls out
  `A2A-Version` handling and unsupported-version rejection as a v1.0 capability
  clients and servers should use.

## Initiative

A2A protocol fidelity through a module-owned channel.

## Acceptance Evidence

- `pnpm test src/modules/a2a-channel`
- `pnpm run typecheck`
- `pnpm exec biome check src/modules/a2a-channel`
- A protocol transcript under `.kota/runs/<run-id>/` showing one accepted v1.0
  request and one unsupported-version JSON-RPC/SSE response that occurs before
  daemon session work.

## Completion Evidence

- `pnpm test src/modules/a2a-channel`
- `pnpm run typecheck`
- `pnpm exec biome check src/modules/a2a-channel`
- `.kota/runs/2026-05-27T07-36-07-584Z-builder-v2alwu/protocol-transcript.txt`
