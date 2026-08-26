import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "#core/workflow/validation.js";
import { computeScopeContentFingerprint } from "./scope-fingerprint.js";
import { collectScopeImprovementInputs } from "./scope-improvement.js";
import { publishScopeImprovement } from "./scope-improvement-publication.js";
import {
  emptyScopeImprovementState,
  reserveScopeImprovementInput,
  SCOPE_IMPROVEMENT_STATE_KEY,
} from "./scope-improvement-state.js";
import { scopePolicySnapshotForTest } from "./scope-policy-test-support.js";
import { scopeImprovementDispatchKey } from "./semantic-request.js";
import scopeImproverWorkflow from "./workflow.js";
import {
  makeScopeFixture,
  runScopeFixtureGit,
  SCOPE_TEST_NOW,
} from "./workflow.test-helpers.js";

describe("scope-improver semantic boundaries", () => {
  const scopeRoots: string[] = [];

  afterEach(() => {
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  function track(label: string): string {
    const workspaceRoot = makeScopeFixture(label);
    scopeRoots.push(workspaceRoot);
    return workspaceRoot;
  }

  it("registers only explicit semantic requests", () => {
    const registered = validateWorkflowDefinitions([
      registerWorkflowDefinition(
        "src/modules/autonomy/workflows/scope-improver/workflow.ts",
        scopeImproverWorkflow,
      ),
    ])[0]!;
    expect(registered.triggers).toEqual([
      expect.objectContaining({
        event: "autonomy.scope-improvement.requested",
        queueMode: "all",
        cooldownMs: 0,
      }),
      expect.objectContaining({
        event: "autonomy.scope-improvement.changed",
        queueMode: "latest",
        cooldownMs: 0,
      }),
    ]);
    expect(registered.triggers.some((trigger) => trigger.schedule || trigger.batch))
      .toBe(false);
  });

  it("recomputes current guidance when a queued automatic request becomes stale", () => {
    const workspaceRoot = track("onboarding-coalescing");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const initial = computeScopeContentFingerprint(
      workspaceRoot,
      scopePolicySnapshotForTest(workspaceRoot).policy,
    );
    const state = reserveScopeImprovementInput(
      emptyScopeImprovementState(scopeId),
      {
        fingerprint: initial.fingerprint,
        boundary: "initial-onboarding",
        delivery: "queued",
        deliveryAttempt: 0,
      },
    );
    writeFileSync(
      join(workspaceRoot, "AGENTS.md"),
      "# Scope\n\n- Preserve the latest owner policy.\n",
    );
    runScopeFixtureGit(workspaceRoot, ["add", "AGENTS.md"]);
    runScopeFixtureGit(workspaceRoot, [
      "-c",
      "user.email=kota@example.test",
      "-c",
      "user.name=KOTA Test",
      "commit",
      "--quiet",
      "--no-gpg-sign",
      "-m",
      "change guidance before consumption",
    ]);
    const current = computeScopeContentFingerprint(
      workspaceRoot,
      scopePolicySnapshotForTest(workspaceRoot).policy,
    );
    const inputs = collectScopeImprovementInputs({
      workspaceRoot,
      state,
      trigger: {
        event: "autonomy.scope-improvement.requested",
        schemaRef: null,
        payload: {
          automatic: true,
          boundary: "initial-onboarding",
          fingerprint: initial.fingerprint,
          deliveryAttempt: 0,
          idempotencyKey: scopeImprovementDispatchKey(
            scopeId,
            initial.fingerprint,
            0,
          ),
        },
      },
      now: SCOPE_TEST_NOW,
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot),
    });

    expect(inputs.semanticInput).toMatchObject({
      automatic: true,
      fingerprint: current.fingerprint,
      evidenceRefs: expect.arrayContaining(["AGENTS.md"]),
    });
  });

  it("publishes owner effects idempotently and returns transactional state", async () => {
    const workspaceRoot = track("publication");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const fingerprint = computeScopeContentFingerprint(
      workspaceRoot,
      scopePolicySnapshotForTest(workspaceRoot).policy,
    );
    const initialState = reserveScopeImprovementInput(
      emptyScopeImprovementState(scopeId),
      {
        fingerprint: fingerprint.fingerprint,
        boundary: "initial-onboarding",
        delivery: "queued",
        deliveryAttempt: 0,
      },
    );
    const transactionalState = createTestTransactionalRunState();
    transactionalState.compareAndSet(
      SCOPE_IMPROVEMENT_STATE_KEY,
      0,
      initialState,
    );
    const trigger = {
      event: "autonomy.scope-improvement.requested",
      schemaRef: null,
      payload: {
        automatic: true,
        boundary: "initial-onboarding",
        fingerprint: fingerprint.fingerprint,
        deliveryAttempt: 0,
        idempotencyKey: scopeImprovementDispatchKey(
          scopeId,
          fingerprint.fingerprint,
          0,
        ),
      },
    };
    const run = await new WorkflowTestHarness(scopeImproverWorkflow, {
      workspaceRoot,
      trigger,
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot),
      contextOverrides: { state: transactionalState },
    }).run();
    expect(run.status).toBe("success");

    const first = publishScopeImprovement({
      scopeRoot: workspaceRoot,
      sourceRunId: "harness",
      currentState: initialState,
    });
    const second = publishScopeImprovement({
      scopeRoot: workspaceRoot,
      sourceRunId: "harness",
      currentState: first.nextState!,
    });

    expect(first).toMatchObject({
      disposition: "published",
      nextState: {
        consumedFingerprint: fingerprint.fingerprint,
        pendingFingerprint: null,
      },
    });
    expect(second.disposition).toBe("published");
    expect(readdirSync(join(workspaceRoot, ".kota", "owner-questions"))).toHaveLength(1);
  });
});
