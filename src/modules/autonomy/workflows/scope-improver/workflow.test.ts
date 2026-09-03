import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "#core/workflow/validation.js";
import scopeImprovementActionsWorkflow from "../scope-improvement-actions/workflow.js";
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
    expect(registered.repository).toBe("none");
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

  it("delegates task effects to one isolated writer workflow", () => {
    const registered = validateWorkflowDefinitions([
      registerWorkflowDefinition(
        "src/modules/autonomy/workflows/scope-improvement-actions/workflow.ts",
        scopeImprovementActionsWorkflow,
      ),
    ])[0]!;

    expect(registered).toMatchObject({
      name: "scope-improvement-actions",
      repository: "write",
      triggers: [expect.objectContaining({ event: "workflow.triggered" })],
      integration: { validationCommand: ["pnpm", "validate-tasks"] },
    });
  });

  it("returns a clean parked action outcome when current policy denies writes", async () => {
    const workspaceRoot = track("writer-policy-revoked");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const staleInputs = collectScopeImprovementInputs({
      workspaceRoot,
      state: emptyScopeImprovementState(scopeId),
      trigger: {
        event: "autonomy.scope-improvement.changed",
        schemaRef: null,
        payload: { reason: "policy changed" },
      },
      now: SCOPE_TEST_NOW,
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot),
    });
    const currentPolicy = scopePolicySnapshotForTest(workspaceRoot, [{
      scopeId,
      reason: "Repository writes were revoked before the writer started.",
      autonomy: { defaultMode: "supervised", maxMode: "supervised" },
      writes: { mode: "none" },
    }]);
    const run = await new WorkflowScenarioDriver(scopeImprovementActionsWorkflow, {
      workspaceRoot,
      scopePolicySnapshot: currentPolicy,
      trigger: {
        event: "workflow.triggered",
        payload: {
          sourceRunId: "stale-scope-improvement-review",
          inputs: {
            ...staleInputs,
            config: { ...staleInputs.config, posture: "propose" },
          },
          recommendations: [],
        },
      },
    }).run();

    expect(run).toMatchObject({
      status: "success",
      steps: {
        "inspect-request": {
          status: "success",
          output: {
            parkedReason: expect.stringContaining(
              "current scope policy denies task-queue writes",
            ),
          },
        },
        "return-actions": {
          status: "success",
          output: {
            applied: [],
            parkedReason: expect.stringContaining(
              "current scope policy denies task-queue writes",
            ),
          },
        },
      },
    });
  });

  it("rechecks live posture before the writer mutates task state", async () => {
    const workspaceRoot = track("writer-posture-revoked");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const staleInputs = collectScopeImprovementInputs({
      workspaceRoot,
      state: emptyScopeImprovementState(scopeId),
      trigger: {
        event: "autonomy.scope-improvement.changed",
        schemaRef: null,
        payload: { reason: "policy changed" },
      },
      now: SCOPE_TEST_NOW,
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot),
    });
    const currentPolicy = scopePolicySnapshotForTest(workspaceRoot, [{
      scopeId,
      reason: "Improvement became observe-only before the writer started.",
      autonomy: { defaultMode: "passive", maxMode: "passive" },
      writes: { mode: "scope-directory" },
    }]);
    const run = await new WorkflowScenarioDriver(scopeImprovementActionsWorkflow, {
      workspaceRoot,
      scopePolicySnapshot: currentPolicy,
      trigger: {
        event: "workflow.triggered",
        payload: {
          sourceRunId: "stale-scope-improvement-review",
          inputs: staleInputs,
          recommendations: [],
        },
      },
    }).run();

    expect(run).toMatchObject({
      status: "success",
      steps: {
        "inspect-request": {
          status: "success",
          output: {
            parkedReason: expect.stringContaining("observation and owner questions only"),
          },
        },
        "return-actions": {
          status: "success",
          output: { applied: [], requiresCommit: false },
        },
      },
    });
  });

  it("does not integrate task proposals that still require owner confirmation", async () => {
    const workspaceRoot = track("writer-confirmation-required");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const staleInputs = collectScopeImprovementInputs({
      workspaceRoot,
      state: emptyScopeImprovementState(scopeId),
      trigger: {
        event: "autonomy.scope-improvement.changed",
        schemaRef: null,
        payload: { reason: "policy changed" },
      },
      now: SCOPE_TEST_NOW,
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot),
    });
    const currentPolicy = scopePolicySnapshotForTest(workspaceRoot, [{
      scopeId,
      reason: "Task files require explicit owner confirmation.",
      autonomy: { defaultMode: "autonomous", maxMode: "autonomous" },
      writes: { mode: "scope-directory" },
      ownerConfirmation: { localWrite: "confirm" },
    }]);
    const run = await new WorkflowScenarioDriver(scopeImprovementActionsWorkflow, {
      workspaceRoot,
      scopePolicySnapshot: currentPolicy,
      trigger: {
        event: "workflow.triggered",
        payload: {
          sourceRunId: "stale-scope-improvement-review",
          inputs: staleInputs,
          recommendations: [{
            kind: "create-task",
            signature: "confirmation-required-task",
            title: "Confirm this task",
            summary: "The owner must approve this write.",
            evidenceIds: [],
            task: {
              problem: "A task is proposed.",
              desiredOutcome: "The owner chooses whether to create it.",
              constraints: [],
              howWeWillKnow: [],
            },
          }],
        },
      },
    }).run();

    expect(run).toMatchObject({
      status: "success",
      steps: {
        "inspect-request": {
          status: "success",
          output: {
            parkedReason: expect.stringContaining(
              "requires owner confirmation for task-queue writes",
            ),
          },
        },
        "return-actions": {
          status: "success",
          output: { applied: [], requiresCommit: false },
        },
      },
    });
    expect(readdirSync(join(workspaceRoot, "data", "tasks"))
      .filter((entry) => entry.endsWith(".md"))).toEqual([]);
  });

  it("waits for proposed-task effects before publishing the review", async () => {
    const workspaceRoot = track("writer-handoff");
    const childActions = {
      createdTaskIds: [],
      ownerQuestionIds: [],
      applied: [{
        kind: "owner-question-pending",
        signature: `${deriveDirectoryScopeId(workspaceRoot)}:missing-scope-guidance`,
      }],
      requiresCommit: false,
      parkedReason: null,
    };
    const run = await new WorkflowScenarioDriver(scopeImproverWorkflow, {
      workspaceRoot,
      trigger: {
        event: "autonomy.scope-improvement.requested",
        payload: { reason: "explicit writer handoff fixture" },
      },
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot),
      stepOutputs: {
        "apply-recommendations": {
          runId: "scope-improvement-actions-child",
          status: "completed",
          childOutput: childActions,
        },
      },
    }).run();

    expect(run).toMatchObject({
      status: "success",
      steps: {
        "apply-recommendations": { status: "success", output: childActions },
        "emit-scope-improvement-publication": { status: "success" },
      },
    });
  });

  it("publishes a late writer-policy denial as deferred instead of failing", async () => {
    const workspaceRoot = track("late-writer-policy-denial");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const policySnapshot = scopePolicySnapshotForTest(workspaceRoot);
    const fingerprint = computeScopeContentFingerprint(
      workspaceRoot,
      policySnapshot.policy,
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
    const parkedReason =
      "scope-improvement actions are parked because current policy denies task writes";
    const run = await new WorkflowScenarioDriver(scopeImproverWorkflow, {
      workspaceRoot,
      scopePolicySnapshot: policySnapshot,
      ports: { state: transactionalState },
      trigger: {
        event: "autonomy.scope-improvement.requested",
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
      },
      stepOutputs: {
        "apply-recommendations": {
          runId: "scope-improvement-actions-policy-denied",
          status: "completed",
          childOutput: {
            createdTaskIds: [],
            ownerQuestionIds: [],
            applied: [],
            requiresCommit: false,
            parkedReason,
          },
        },
      },
    }).run();
    expect(run.status).toBe("success");

    expect(publishScopeImprovement({
      scopeRoot: workspaceRoot,
      sourceRunId: basename(run.runDirPath),
      currentState: initialState,
    })).toMatchObject({
      disposition: "deferred",
      nextState: {
        consumedFingerprint: null,
        pendingDelivery: "deferred",
        pendingDeliveryAttempt: 1,
      },
    });
  });

  it("publishes disabled automatic input as deferred instead of stranding it queued", async () => {
    const workspaceRoot = track("disabled-automatic-input");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    mkdirSync(join(workspaceRoot, ".kota", "scope-improvement"), {
      recursive: true,
    });
    writeFileSync(
      join(workspaceRoot, ".kota", "scope-improvement", "config.json"),
      `${JSON.stringify({ enabled: false, maxActionsPerRun: 2 })}\n`,
    );
    const policySnapshot = scopePolicySnapshotForTest(workspaceRoot);
    const fingerprint = computeScopeContentFingerprint(
      workspaceRoot,
      policySnapshot.policy,
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
    const run = await new WorkflowScenarioDriver(scopeImproverWorkflow, {
      workspaceRoot,
      scopePolicySnapshot: policySnapshot,
      ports: { state: transactionalState },
      trigger: {
        event: "autonomy.scope-improvement.requested",
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
      },
    }).run();
    expect(run.status).toBe("success");

    const published = publishScopeImprovement({
      scopeRoot: workspaceRoot,
      sourceRunId: basename(run.runDirPath),
      currentState: initialState,
    });
    expect(published).toMatchObject({
      disposition: "deferred",
      nextState: {
        pendingFingerprint: fingerprint.fingerprint,
        pendingDelivery: "deferred",
        pendingDeliveryAttempt: 1,
      },
    });
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
    const policySnapshot = scopePolicySnapshotForTest(workspaceRoot, [{
      scopeId,
      reason: "Observe-only publication fixture",
      autonomy: { defaultMode: "passive", maxMode: "passive" },
      writes: { mode: "none" },
    }]);
    const fingerprint = computeScopeContentFingerprint(
      workspaceRoot,
      policySnapshot.policy,
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
    const run = await new WorkflowScenarioDriver(scopeImproverWorkflow, {
      workspaceRoot,
      trigger,
      scopePolicySnapshot: policySnapshot,
      ports: { state: transactionalState },
    }).run();
    expect(run.status).toBe("success");

    const first = publishScopeImprovement({
      scopeRoot: workspaceRoot,
      sourceRunId: basename(run.runDirPath),
      currentState: initialState,
    });
    const second = publishScopeImprovement({
      scopeRoot: workspaceRoot,
      sourceRunId: basename(run.runDirPath),
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
