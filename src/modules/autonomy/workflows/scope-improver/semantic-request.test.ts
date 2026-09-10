import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import { inspectScopeSemanticBoundary } from "../dispatcher/semantic-scope-reflection.js";
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
    const state = createTestTransactionalRunState(join(workspaceRoot, ".kota", "test-state"), scopeId);
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

    expect(first.status, first.error).toBe("success");
    expect(first.emitted).toHaveLength(1);
    expect(second.status, second.error).toBe("success");
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
  it("reconciles an eligible existing scope through the onboarding owner without a lifecycle event", () => {
    const workspaceRoot = makeScopeFixture("existing-initialization");
    scopeRoots.push(workspaceRoot);
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const state = decodeScopeImprovementState(null, scopeId);
    const args = { workspaceRoot, scopeRoot: workspaceRoot, scopeId, stateDir: join(workspaceRoot, ".kota"), scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot), state };
    const first = inspectScopeSemanticBoundary(args);
    expect(first).toMatchObject({ shouldEmit: true, payload: { boundary: "initial-onboarding", requestedBy: "scope-improvement-onboarding" } });
    const restored = JSON.parse(JSON.stringify(first.nextState));
    expect(inspectScopeSemanticBoundary({ ...args, state: restored }).shouldEmit).toBe(false);
  });

});
