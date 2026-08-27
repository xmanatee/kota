---
status: done
---

# Add A2A push notification configuration support

## Problem

KOTA's A2A channel now exposes daemon sessions as v1.0 A2A tasks with Agent
Card discovery, version negotiation, tenant routing, streaming updates, task
list/get/cancel, and guarded session execution. Push notification support is
still explicitly absent: `src/modules/a2a-channel/agent-card.ts` advertises
`capabilities.pushNotifications: false`, and
`src/modules/a2a-channel/protocol.ts` rejects push notification fields with
`A2A push notifications are not supported by this KOTA channel`.

That was the right first-slice boundary, but it leaves a protocol-visible gap.
A2A v1.0 treats push notification configuration as part of the core task update
surface: clients can create, get, list, and delete callback configurations for
task updates instead of holding an SSE stream open. Without this, remote A2A
clients that delegate long-running KOTA tasks must poll, keep a stream open, or
fall back to KOTA-specific notification channels.

The risky part is not sending an HTTP callback. The risky part is preserving
KOTA's approval, owner-question, auth, and project-scope boundaries when a
protocol client asks for asynchronous delivery. A2A callbacks must report task
state and sanitized artifacts only; they must not become a route that can answer
pending approvals, resolve owner prompts, reveal private run internals, or
cross project scopes.

## Desired Outcome

The A2A channel implements v1.0 push notification configuration for
daemon-backed session tasks. A2A clients can register an authenticated callback
for one task, inspect/list/delete those registrations, and receive task status
or artifact update payloads after the daemon records session progress.

The implementation should map onto existing KOTA primitives:

- A2A push configuration is owned by `src/modules/a2a-channel/` and stored in a
  daemon-restart-safe way appropriate for module state.
- Callback delivery uses KOTA's existing notification/retry posture where that
  can be reused without creating a generic outbound-webhook primitive in core.
- Payloads reuse the same sanitized `TaskStatusUpdateEvent` and
  `TaskArtifactUpdateEvent` shapes already emitted through A2A streaming.
- Agent Cards advertise `pushNotifications: true` only when create/get/list/delete
  config behavior, delivery, unsubscribe, and tests all exist.

## Constraints

- Keep the work inside the A2A channel and existing notification/module
  infrastructure unless a small shared helper is already the owned seam. Do not
  add a parallel A2A task store, workflow engine, session runtime, or generic
  callback framework in core.
- Treat callback URLs, auth material, task ids, tenants, and project ids as
  external input. Validate once at the A2A boundary and preserve the existing
  tenant-to-project mismatch rejection before daemon/session work starts.
- Support only callback authentication that KOTA can store and transmit
  safely. Do not log secrets, echo credentials in task history, or expose them
  through Agent Cards, run artifacts, task artifacts, or errors.
- Push delivery is outbound notification only. It must not accept inbound
  callback responses as approval answers, owner-question answers, task
  mutations, workflow triggers, or session messages.
- Do not deliver internal reasoning traces, tool payloads, memory state,
  workflow run internals, raw `.kota/` files, or unsanitized daemon events.
- Preserve existing streaming behavior. Push notifications supplement
  `SendStreamingMessage` and `SubscribeToTask`; they do not replace or weaken
  SSE capability validation.
- Keep exact A2A method names, error mapping, and capability flags in source
  types and focused tests, not in a durable docs catalog.

## Done When

- The A2A JSON-RPC endpoint supports the v1.0 push notification configuration
  operations for daemon-backed tasks:
  `CreateTaskPushNotificationConfig`, `GetTaskPushNotificationConfig`,
  `ListTaskPushNotificationConfigs`, and `DeleteTaskPushNotificationConfig`.
- Task-scoped configuration persists across daemon restart and is removed when
  the client deletes it or when the owning task/session can no longer be
  resolved.
- Registered callbacks receive only sanitized A2A task status/artifact update
  payloads for the matching task and project/tenant scope.
- Callback authentication is stored and applied without secret leakage in logs,
  errors, Agent Cards, task history, or artifacts.
- Unsupported or malformed configs fail with typed A2A/JSON-RPC errors before
  daemon work starts; mismatched tenant/project selectors still fail at the A2A
  boundary.
- Agent Cards advertise `capabilities.pushNotifications: true` only after the
  implementation is complete; partial support stays honestly advertised as
  unsupported.
- Focused tests cover create/get/list/delete, auth redaction, restart
  persistence, delivery on task updates, unsubscribe/no-delivery after delete,
  routing-scope mismatch rejection, unsupported malformed configs, and no
  inbound approval/owner-answer effect from callback responses.

## Source / Intent

Explorer run `2026-06-22T02-09-20-023Z-explorer-m4i6yv` reviewed a thin queue:
two ready tasks, zero backlog tasks, and four strategic blocked alternatives
that all still require operator-captured artifacts. None of the blocked
alternatives were movable, and the existing ready queue contains one security
fix plus one p3 maintenance split, so a nonduplicative protocol-fidelity task
is a better next ready item than noop or surface fan-out work.

Primary source checked:

- https://a2a-protocol.org/latest/specification/ defines push notification
  configuration as v1.0 core operations, including create/get/list/delete
  methods, task update delivery mechanisms, payload objects, capability
  validation, and security requirements for authenticated protocol operations.

Local evidence:

- `src/modules/a2a-channel/agent-card.ts` currently advertises
  `pushNotifications: false` and `metadata.pushNotificationsImplemented: false`.
- `src/modules/a2a-channel/protocol.ts` rejects any push notification config
  fields with `A2A push notifications are not supported by this KOTA channel`.
- Prior A2A tasks intentionally completed the first channel slice, version
  negotiation, and tenant routing while leaving push notifications out of scope.
  There is no open task for this remaining A2A capability.

## Initiative

A2A protocol fidelity through module-owned channels: KOTA should be a
well-behaved A2A peer for long-running daemon sessions without exposing a
parallel runtime or bypassing approval and project-scope guardrails.

## Acceptance Evidence

- `pnpm test src/modules/a2a-channel`
- `pnpm run typecheck`
- `pnpm exec biome check src/modules/a2a-channel`
- A protocol transcript under `.kota/runs/<run-id>/` showing create/get/list,
  a delivered task update callback, delete/unsubscribe, and one callback
  response that cannot resolve a pending approval or owner question.

## Completion Evidence

- `pnpm test src/modules/a2a-channel` passed.
- `pnpm run typecheck` passed.
- `pnpm exec biome check src/modules/a2a-channel` passed.
- Protocol transcript recorded at
  `.kota/runs/2026-06-22T03-02-11-073Z-builder-qb0sve/a2a-push-protocol-transcript.txt`.
