---
id: task-prove-native-delegate-quarantine-under-a-mid-run-a
title: Prove native delegate quarantine under a mid-run authority restriction
status: done
priority: p1
area: security
task_class: Safety
summary: Add an adversarial runtime regression in which a KOTA-controlled parent launches a native delegate, policy becomes restrictive during execution, and all later native activity and stale completion are rejected.
depends_on: [task-wire-native-agent-sdk-delegates-into-live-invalida]
created_at: 2026-08-05T12:37:15.050Z
updated_at: 2026-08-05T16:13:43.365Z
---

## Problem

    Unit-level plumbing alone does not prove the operator-visible security outcome. The original runtime probe demonstrated that a live native delegate was not aborted and its stale success was accepted after authority tightened, so the full parent-to-native path needs a durable regression.

## Desired Outcome

    A deterministic runtime regression holds a native delegate open, applies a restrictive scope-policy revision, observes quarantine completion, and proves that no subsequent native action, output, or successful terminal result is accepted and that the policy listener is released.

## Constraints

- Exercise a KOTA-controlled parent and a native tool-control delegate rather than replacing the boundary with mocks that bypass routing.
- Apply the restrictive revision after the native delegate has started.
- Attempt post-restriction native activity and stale completion so the assertions cannot pass vacuously.
- Keep the regression deterministic and network-free.
- Retain the original confirmed finding until this runtime proof passes.

## Done When

- The regression proves the native delegate has started before policy is restricted.
- The restrictive revision aborts the child and native quarantine completes.
- A deliberately attempted post-restriction native action produces no accepted effect.
- Late native output and stale successful terminal output are rejected.
- The restrictive-policy and parent-abort listeners are absent after completion.
- The task records the exact verification command and passing runtime artifact or transcript.

## Source / Intent

    Closes the acceptance-evidence requirement from confirmed finding native-delegate-restriction-quarantine-gap by converting its failing runtime probe into a permanent regression after the delegate launch path is fixed.

Decomposed from `task-security-review-a-kota-hosted-parent-can-launch-an` after builder run `2026-08-05T11-38-20-249Z-builder-qnyrnq` exhausted repair.

## Initiative

    Agentic security review for autonomous coding infrastructure.

## Acceptance Evidence

- Passing adversarial runtime regression transcript showing start, mid-run restriction, child abort, quarantine, rejected late action, and rejected stale terminal success.
- Concrete transcript: .kota/runs/2026-08-05T14-47-33-579Z-builder-1wxf9t/evidence/artifacts/native-delegate-quarantine-transcript.txt
- Listener instrumentation or assertions proving no parent-abort or restrictive-policy subscription leaks after the run.
- Recorded focused verification command in the completed task evidence.

## Verification

Focused evidence command: NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner --silent=false --reporter=verbose src/core/tools/delegate-harness.test.ts src/core/tools/delegate-harness-quarantine.test.ts

Passed: 2 test files and 6 tests.

Broadened command: NODE_OPTIONS=--conditions=source pnpm exec vitest run --configLoader runner --silent=false --reporter=verbose src/core/tools/delegate-harness.test.ts src/core/tools/delegate-harness-quarantine.test.ts src/core/agent-harness/runner-cancellation.test.ts src/core/agent-harness/native-agent-invalidation.test.ts src/core/agent-harness/runner.test.ts src/core/tools/delegate.test.ts src/core/tools/tool-runner-live-scope-policy.test.ts

Passed: 7 test files and 33 tests.

Runtime transcript: .kota/runs/2026-08-05T14-47-33-579Z-builder-1wxf9t/evidence/artifacts/native-delegate-quarantine-transcript.txt. It captures the regression's structured runtime-emitted events for the hosted parent start, revision 7 -> 8 restriction, observed child abort, completed quarantine, rejected post-restriction effect, rejected late writer output and stale success, and zero leaked authority or parent-abort listeners.
