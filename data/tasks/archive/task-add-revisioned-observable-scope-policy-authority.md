---
status: done
---

# Add revisioned, observable scope-policy authority

## Problem

    Workflow execution has no authoritative revision or notification mechanism for detecting that permissions changed after an agent step started. Consumers therefore retain a policy object without a reliable way to distinguish current authority from stale authority.

## Desired Outcome

    Provide a single core authority source that returns an atomic policy-and-revision snapshot, advances monotonically on policy mutations, and notifies active consumers when a mutation is restrictive.

## Constraints

- Preserve every existing scope-policy restriction, including write, module, network, tool, and autonomy limits.
- Do not treat a permissive mutation as authorization to bypass approval, tool-risk, secret-handling, injection-defense, or autonomy gates.
- Keep the authority contract protocol-oriented in core and avoid compatibility wrappers or parallel policy stores.
- Restrictive-change detection must be explicit and covered for every security-relevant policy dimension.

## Done When

- Scope-policy reads expose an atomic policy snapshot with a monotonically increasing authority revision.
- Policy mutation publishes enough information for active workflow executions to detect restrictive changes without polling stale objects.
- Focused tests prove revisions advance correctly and restrictive changes are distinguished from equal or purely permissive changes.
- The final focused verification command and passing result are recorded in the task.

## Source / Intent

    Foundation for confirmed finding active-workflow-scope-policy-snapshot from security-review run 2026-08-02T12-54-03-665Z; the cited run-executor path currently resolves scope policy only once for an agent step.

Decomposed from `task-security-review-workflow-agent-steps-snapshot-scop` after builder run `2026-08-03T11-27-25-516Z-builder-s4o6v0` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Focused unit tests exercising atomic snapshots, monotonic revisions, and restrictive-change notifications.
- A recorded passing verification command covering the new authority contract.

## Verification

`TMPDIR="$PWD/.kota/tmp" NODE_OPTIONS=--conditions=source node_modules/.bin/vitest run --configLoader runner --silent=true --reporter=dot src/core/daemon/scope-authority-operator-token.test.ts src/core/daemon/scope-authority-service.test.ts src/core/daemon/scope-authority-store.test.ts src/core/daemon/scope-authority.integration.test.ts src/core/daemon/scope-policy-widening.test.ts src/core/daemon/scope-policy.test.ts src/core/daemon/client-contract.test.ts src/core/daemon/daemon-control.test.ts src/core/workflow/run-executor-scope-policy.test.ts src/core/workflow/steps/step-context-scope-policy.test.ts src/modules/setup/scope-client.test.ts src/contract-fixture-cross-client.integration.test.ts clients/web/src/api/contractFixture.test.ts`

Passed on 2026-08-03: 12 test files and 173 tests passed.
