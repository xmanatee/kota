---
status: open
priority: p2
---
# Reject malformed A2A routing selectors through one module-owned decoder

## Problem

Duplicated A2A routing decoders have divergent string validation. Ordinary task requests accept malformed supplied tenant/scopeId values as absence, allowing a request to reach daemon default routing; push configuration rejects equivalent values. The retained probe demonstrates numeric, empty and null tenant values producing /sessions without a scope query. Follow up the archived tenant-routing and push-support contracts with this concrete counterevidence.

Investigation: At revision 5ebd9ab4a53f58de375c86af0f440eb82abd00d5, observation fe09322b1d1896470b7b72eb exposes duplicated A2A routing logic with different validation semantics. Ordinary task decoding silently treats numeric, empty and null tenant values as absent; push configuration rejects them. A successful probe using production decoders and DaemonA2ABackend, with only its HTTP port substituted, confirmed that malformed ordinary selectors produce a /sessions request without a scope query. This establishes unintended fallback, not an authentication bypass or cross-scope disclosure.

Both paths are maintained: module registration exposes the RPC routes, ordinary send/task operations consume protocol.ts, and push configuration operations consume push-notification-protocol.ts. Routing collection and conflict detection share one domain and can belong to the existing A2A protocol owner. Observation 26001faa04051137c6c94317 is a genuine duplicate optional-object helper, but independently warrants no task; it may be consolidated locally during the routing repair if that simplifies callers.

Active task summaries and inbox search showed no overlapping A2A work. Archived tenant-routing and push-support contracts establish the intended boundary validation, but their terminal status does not establish current correctness. This is follow-up evidence against those outcomes, not a claim that their entire implementations were reviewed. Previous unrelated judgments and proposal identities remain undisturbed. No supplied delivery issue was causally linked; one sampled builder record and the archived push transcript were unavailable in this checkout.

The decoder/backend probe passed. The selected HTTP suites were interrupted after the first case timed out; no passing HTTP verification is claimed. No tracked files were changed. Only the two named observations are assessed; remaining fingerprints stay unreviewed.

Evidence:
- fe09322b1d1896470b7b72eb
- 26001faa04051137c6c94317
- docs/STANDARDS.md
- docs/VERIFICATION.md
- docs/ARCHITECTURE.md
- src/modules/a2a-channel/AGENTS.md
- src/modules/a2a-channel/index.ts
- src/modules/a2a-channel/protocol.ts
- src/modules/a2a-channel/push-notification-protocol.ts
- src/modules/a2a-channel/routes.ts
- src/modules/a2a-channel/push-notification-rpc.ts
- src/modules/a2a-channel/daemon-session-client.ts
- src/modules/a2a-channel/daemon-session-client.test.ts
- src/modules/a2a-channel/routes.rpc.test.ts
- src/modules/a2a-channel/routes.rpc-errors.test.ts
- src/modules/a2a-channel/push-notification-config-validation.test.ts
- data/tasks/archive/task-map-a2a-tenant-routing-to-kota-project-scoping.md
- data/tasks/archive/task-add-a2a-push-notification-configuration-support.md
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t03-02-30-836z-archite-bf3714951a410ec46a3c855d0ef14b6ca9e5cd819f47671e9782d46762cbad80/agent/a2a-routing-probe.mjs
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t03-02-30-836z-archite-bf3714951a410ec46a3c855d0ef14b6ca9e5cd819f47671e9782d46762cbad80/agent/a2a-routing-probe.json
- /Users/xmanatee/Desktop/mono/apps/kota/.kota/runtime/2026-09-14t03-02-30-836z-archite-bf3714951a410ec46a3c855d0ef14b6ca9e5cd819f47671e9782d46762cbad80/agent/a2a-tests.log

## Desired Outcome

All A2A task and push configuration operations reject malformed supplied routing selectors before backend work. Genuinely absent selectors retain existing default routing, valid selectors propagate unchanged, and conflicting routing values retain typed rejection. A single local routing decoder is expected to prevent further drift; that maintenance benefit remains unverified.

This is an unverified expectation, not a measured improvement.

Maintained consumers:
- SendMessage and SendStreamingMessage
- GetTask, ListTasks, CancelTask and SubscribeToTask
- CreateTaskPushNotificationConfig, GetTaskPushNotificationConfig, ListTaskPushNotificationConfigs and DeleteTaskPushNotificationConfig

Alternatives considered:
- Leave the code unchanged: retains demonstrated malformed-selector fallback.
- Repair only the ordinary decoder: fixes the immediate behavior but retains duplicate routing authority.
- Consolidate routing at the existing A2A protocol owner: preferred because collection, validation and conflict handling share one domain.
- Extract a generic core selector framework: unnecessary; no maintained consumer outside A2A establishes that abstraction.
- Delete either routing path without migration: invalid because both serve registered operations.

Migration and retirement: Route both protocol families through one A2A-owned decoder, then remove their duplicate routing collection and conflict implementations. Keep message/config envelope selection, contextId semantics, callback validation and domain-specific field decoding local. Do not globally change the permissive stringField helper merely to repair routing. Consolidate the optional-object helper only where it simplifies these callers. Link the generated task to the two archived source contracts.

Common behavior: Validate optional tenant/scopeId strings, collect them from supported envelopes and metadata, reject conflicts, and return one normalized routing scope.
Stable variation point: Callers select the relevant message or push configuration envelope; task identifiers, context identifiers and callback fields remain domain-owned.
Canonical owner: src/modules/a2a-channel/protocol.ts or a local routing helper owned by that protocol

## Constraints

Preserve the maintained consumers' domain-specific behavior.

## How We Will Know

Exercise public JSON-RPC and SSE routes to show malformed supplied tenant/scopeId values fail before backend invocation, including selectors nested in supported metadata/envelopes. Cover absent routing, valid matching routing, conflicting aliases and repeated conflicting values. Verify valid scope propagation and independent contextId behavior at the daemon transport boundary. Retain callback credential, authorization and streaming checks. Resolve or use an appropriate alternative to the HTTP test timeout; do not claim live daemon or security acceptance from the retained probe alone.

Show that every maintained A2A operation uses one routing decoder and the replaced routing implementations are removed. Keep shared routing behavior at one owning test layer while retaining distinct consumer propagation and security checks. Compare resulting callers and ownership directly; deletion counts do not establish improvement.

Record actual migrated callers, retired paths and the simpler result in this task's completion evidence. The gardener follows this task; expected benefits alone do not establish success.
