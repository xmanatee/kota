import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import onboardingWorkflow from "../scope-improvement-onboarding/workflow.js";
import {
  decodeScopeImprovementState,
  SCOPE_IMPROVEMENT_STATE_KEY,
} from "./scope-improvement-state.js";
import { scopePolicySnapshotForTest } from "./scope-policy-test-support.js";
import { scopeImprovementDispatchKey } from "./semantic-request.js";
import { makeScopeFixture } from "./workflow.test-helpers.js";

describe("scope improvement onboarding workflow", () => {
  const scopeRoots: string[] = [];

  afterEach(() => {
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("durably reserves and emits one initial request across restart replay", async () => {
    const workspaceRoot = makeScopeFixture("production-onboarding");
    scopeRoots.push(workspaceRoot);
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const state = createTestTransactionalRunState();
    const options = {
      workspaceRoot,
      trigger: {
        event: "scope.lifecycle.changed",
        schemaRef: null,
        eventId: "scope-onboarding:onboard_fixture:completed",
        payload: {
          transition: "onboarding-completed",
          affectedScopeId: scopeId,
          directoryRoot: workspaceRoot,
          displayName: "External scope",
          idempotencyKey: "scope-onboarding:onboard_fixture:completed",
        },
      },
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot),
      ports: { state },
    } as const;

    const first = await new WorkflowScenarioDriver(onboardingWorkflow, options).run();
    const second = await new WorkflowScenarioDriver(onboardingWorkflow, options).run();

    expect(first.status).toBe("success");
    expect(first.emitted).toHaveLength(1);
    expect(second.status).toBe("success");
    expect(second.emitted).toEqual([]);
    const payload = first.emitted[0]?.payload;
    expect(payload).toMatchObject({
      automatic: true,
      boundary: "initial-onboarding",
      deliveryAttempt: 0,
    });
    expect(payload?.idempotencyKey).toBe(
      scopeImprovementDispatchKey(
        scopeId,
        String(payload?.fingerprint),
        0,
      ),
    );
    expect(
      decodeScopeImprovementState(
        state.read(SCOPE_IMPROVEMENT_STATE_KEY).value,
        scopeId,
      ),
    ).toMatchObject({
      consumedFingerprint: null,
      pendingFingerprint: payload?.fingerprint,
      pendingBoundary: "initial-onboarding",
      pendingDelivery: "queued",
      pendingDeliveryAttempt: 0,
    });
  });
});
