---
id: task-add-observability-evidence-for-resource-discovery-
title: Add observability evidence for resource-discovery client wiring
status: ready
priority: p2
area: modules
summary: Builder run 2026-06-24T22-45-17-701Z-builder-q982rr committed resource-discovery KotaClient/daemon wiring, but its observability-obligation review marked src/core/server/daemon-client-test-stubs.ts, daemon-client.ts, kota-client.ts, local-kota-client.ts, and project-scoped-kota-client.ts as missing inspectable evidence.
created_at: 2026-06-25T01:33:48.557Z
updated_at: 2026-06-25T01:33:48.557Z
---

## Problem

Builder run 2026-06-24T22-45-17-701Z-builder-q982rr committed resource-discovery KotaClient/daemon wiring, but its observability-obligation review marked src/core/server/daemon-client-test-stubs.ts, daemon-client.ts, kota-client.ts, local-kota-client.ts, and project-scoped-kota-client.ts as missing inspectable evidence.

## Desired Outcome

Resolve the progress-review finding from run 2026-06-25T01-27-54-665Z-progress-reviewer-olbiwt.

## Constraints

- Preserve the cited evidence ids until the task is resolved.
- Do not treat this seeded task as proof that the finding is already fixed.

## Done When

- The cited progress gap is fixed or explicitly disproven with evidence.
- Acceptance evidence is recorded in this task or its run artifact.

## Source / Intent

Created by progress-reviewer workflow run 2026-06-25T01-27-54-665Z-progress-reviewer-olbiwt.

review verdict: needs-steering
review summary: Balance is Safety 3, Product 1, Platform 5, Meta 1, Unclassified 10. Recent scoped work mostly succeeded with no operator-journey risk flags, but the latest builder run left an unresolved observability-obligation warning for five core server/client files.

Evidence ids:

- run:2026-06-24T22-45-17-701Z-builder-q982rr
- task:task-add-agentic-resource-discovery-over-kota-capabilit
- git:commit:9b8daff9971b
- task:task-add-observability-evidence-for-agent-authored-runt

## Initiative

Outcome-aware autonomy progress review.

## Acceptance Evidence

- A follow-up run artifact or task acceptance section maps each of the five cited files to structured logging, event, run-artifact, explicit error result, focused test assertion, or an explicit waiver rationale; the observability-obligation diagnostic reports no unresolved missing files for this change; focused resource-discovery KotaClient/daemon wiring tests pass.
