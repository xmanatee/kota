---
id: task-wire-native-agent-sdk-delegates-into-live-invalida
title: Wire native agent-sdk delegates into live invalidation and quarantine
status: ready
priority: p1
area: security
task_class: Safety
summary: Give every KOTA-hosted native delegate a live child abort controller, restrictive-policy subscription, and native runner quarantine instead of relying on its launch-time policy snapshot.
depends_on: [task-make-native-agent-invalidation-lifecycle-reusable]
created_at: 2026-08-05T12:37:15.050Z
updated_at: 2026-08-05T12:37:15.050Z
---

## Problem

    runDelegateHarness caps autonomy from a launch-time scope-policy snapshot, while native tool-control routing discards the live accessor and no abort controller reaches runAgentHarness. The native runner therefore does not require quarantine, allowing a delegate to continue after its parent is aborted or its authority becomes more restrictive.

## Desired Outcome

    Native delegate launch creates the canonical invalidation lifecycle from the inherited tool-call execution context, passes its AbortController into runAgentHarness so native quarantine is mandatory, and cleans up in every terminal path. A native delegate that cannot be covered by required live invalidation fails closed before launch.

## Constraints

- Keep launch-time autonomy capping as defense in depth while adding live invalidation.
- Do not route KOTA canUseTool enforcement into harnesses whose tool control is native.
- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense behavior.
- Use one AbortController per delegate invocation and release its lifecycle in a finally-equivalent path.
- Keep hosted and non-native delegate behavior unchanged unless shared cleanup requires a behavior-preserving refactor.

## Done When

- The inherited parent tool-call AbortSignal is connected to the native delegate child controller.
- Restrictive scope-policy revisions abort an active native delegate through the canonical subscription.
- The child AbortController reaches runAgentHarness and activates its native quarantine requirement.
- A KOTA-hosted native delegate lacking the live invalidation context required for safe execution fails before the native harness launches.
- Success, thrown failure, and abort paths all dispose the invalidation lifecycle.
- Focused delegate-harness and agent-harness runner tests guard the new routing and preserve existing native tool-control isolation.

## Source / Intent

    Implements the confirmed native-delegate-restriction-quarantine-gap at src/core/tools/delegate-harness.ts while preserving the evidence and constraints recorded by security-review run 2026-08-04T04-04-56-434Z-security-review-0z9fqt.

Decomposed from `task-security-review-a-kota-hosted-parent-can-launch-an` after builder run `2026-08-05T11-38-20-249Z-builder-qnyrnq` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused delegate-harness tests showing the inherited parent signal and restrictive revision abort the native child and that an unsafe launch fails closed.
- Focused runner test showing the supplied child AbortController activates native quarantine.
- Validation transcript for affected delegate-harness, workflow-step, and agent-harness tests.
