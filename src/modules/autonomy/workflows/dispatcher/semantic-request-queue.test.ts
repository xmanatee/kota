import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import {
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "#core/events/module-event.js";
import { ScopedEventBus } from "#core/events/scope.js";
import type { DurableEffectValue } from "#core/workflow/run-context.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinitionInput,
} from "#core/workflow/types.js";
import {
  createTestWorkflowRuntime,
  type TestWorkflowRuntime,
} from "../../autonomy-runtime.test-helpers.js";
import {
  automaticProgressReviewRequested,
  progressReviewRequested,
} from "../progress-reviewer/events.js";
import {
  PROGRESS_REVIEW_STATE_KEY,
  type ProgressReviewConsumptionState,
  progressReviewDispatchKey,
} from "../progress-reviewer/semantic-input.js";
import progressReviewerWorkflow from "../progress-reviewer/workflow.js";
import {
  scopeImprovementChanged,
  scopeImprovementRequested,
} from "../scope-improver/events.js";
import {
  emptyScopeImprovementState,
  reserveScopeImprovementInput,
  SCOPE_IMPROVEMENT_STATE_KEY,
} from "../scope-improver/scope-improvement-state.js";
import type { ScopeImprovementState } from "../scope-improver/scope-improvement-types.js";
import { scopeImprovementDispatchKey } from "../scope-improver/semantic-request.js";
import scopeImproverWorkflow from "../scope-improver/workflow.js";

function queueOnlyWorkflow(
  workflow: WorkflowDefinitionInput,
): RegisteredWorkflowDefinitionInput {
  return {
    repository: "read",
    name: workflow.name,
    description: workflow.description,
    triggerAdmission: workflow.triggerAdmission,
    definitionPath: `semantic-request-queue:${workflow.name}`,
    moduleRoot: process.cwd(),
    triggers: workflow.triggers,
    steps: [{ id: "noop", type: "code", run: () => ({ ok: true }) }],
  };
}

describe("semantic review request queue isolation", () => {
  const scopeRoots: string[] = [];
  const runtimeFixtures: TestWorkflowRuntime[] = [];

  afterEach(() => {
    resetModuleEventRegistry();
    for (const fixture of runtimeFixtures.splice(0)) fixture.runState.close();
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  function runtimeFor(workflow: WorkflowDefinitionInput) {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "kota-semantic-request-queue-"));
    scopeRoots.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, ".kota"), { recursive: true });
    const bus = new EventBus();
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const pbus = new ScopedEventBus(bus, scopeId);
    const fixture = createTestWorkflowRuntime({
      bus,
      pbus,
      scopeRoot: workspaceRoot,
      scopeId: scopeId,
      idleIntervalMs: 60_000,
      workflows: [queueOnlyWorkflow(workflow)],
    });
    runtimeFixtures.push(fixture);
    const { runtime } = fixture;
    runtime.start();
    runtime.setDispatchPaused(true);
    return { runtime, pbus, workspaceRoot, runState: fixture.runState, scopeId };
  }

  function persistScopeState(
    runtime: ReturnType<typeof runtimeFor>,
    key: string,
    state: DurableEffectValue,
  ): void {
    const now = new Date().toISOString();
    const current = runtime.runState.readScopeStateValue(
      runtime.scopeId,
      key,
    );
    const runId = `seed-scope-state-${current.revision}`;
    runtime.runState.admitRun({
      id: runId,
      scopeId: runtime.scopeId,
      workflow: "test-state-seed",
      repository: "none",
      trigger: { event: "test.seed", schemaRef: null, payload: {} },
      resources: [],
      admittedAt: now,
    });
    runtime.runState.startRun(runId, 1, now);
    runtime.runState.stageScopeStateMutation({
      runId,
      key,
      expectedRevision: current.revision,
      value: state,
      stagedAt: now,
    });
    runtime.runState.finishRun(runId, 1, "succeeded", now);
  }

  function persistScopeImprovementState(
    runtime: ReturnType<typeof runtimeFor>,
    state: ScopeImprovementState,
  ): void {
    persistScopeState(runtime, SCOPE_IMPROVEMENT_STATE_KEY, state);
  }

  it("preserves every explicit progress request beside one latest automatic revision", async () => {
    const events = initModuleEventRegistry();
    events.register("autonomy", progressReviewRequested);
    events.register("autonomy", automaticProgressReviewRequested);
    const { runtime, pbus, workspaceRoot } = runtimeFor(progressReviewerWorkflow);
    const scopeId = deriveDirectoryScopeId(workspaceRoot);

    pbus.emit(progressReviewRequested, { reason: "owner request one" });
    pbus.emit(progressReviewRequested, { reason: "owner request two" });
    const revisionOne = {
      automatic: true,
      boundary: "parked-queue" as const,
      inputRevision: 1,
      deliveryAttempt: 0,
      idempotencyKey: progressReviewDispatchKey(scopeId, 1, 0),
    };
    pbus.emit(automaticProgressReviewRequested, revisionOne);
    const revisionTwo = {
      automatic: true,
      boundary: "strategic-completion" as const,
      inputRevision: 2,
      deliveryAttempt: 0,
      idempotencyKey: progressReviewDispatchKey(scopeId, 2, 0),
    };
    pbus.emit(automaticProgressReviewRequested, revisionTwo);
    pbus.emit(automaticProgressReviewRequested, revisionOne);
    await runtime.stop();

    const pending = runtime.getState().pendingRuns;
    expect(pending.map((run) => run.trigger.payload.reason)).toEqual([
      "owner request one",
      "owner request two",
      undefined,
    ]);
    expect(pending[2]?.trigger.payload).toMatchObject({
      automatic: true,
      boundary: "strategic-completion",
      inputRevision: 2,
    });
  });

  it("preserves explicit scope requests beside one latest policy fingerprint", async () => {
    const events = initModuleEventRegistry();
    events.register("autonomy", scopeImprovementRequested);
    events.register("autonomy", scopeImprovementChanged);
    const scope = runtimeFor(scopeImproverWorkflow);
    const { runtime, pbus, scopeId } = scope;

    pbus.emit(scopeImprovementRequested, { reason: "owner request one" });
    pbus.emit(scopeImprovementRequested, { reason: "owner request two" });
    const firstFingerprint = "scope-content:first";
    let scopeState = reserveScopeImprovementInput(
      emptyScopeImprovementState(scopeId),
      {
        fingerprint: firstFingerprint,
        boundary: "content-policy-changed",
        delivery: "queued",
        deliveryAttempt: 0,
      },
    );
    persistScopeImprovementState(scope, scopeState);
    const firstChange = {
      automatic: true,
      boundary: "content-policy-changed" as const,
      fingerprint: firstFingerprint,
      deliveryAttempt: 0,
      idempotencyKey: scopeImprovementDispatchKey(scopeId, firstFingerprint, 0),
    };
    pbus.emit(scopeImprovementChanged, firstChange);
    const secondFingerprint = "scope-content:second";
    scopeState = reserveScopeImprovementInput(scopeState, {
      fingerprint: secondFingerprint,
      boundary: "content-policy-changed",
      delivery: "queued",
      deliveryAttempt: 0,
    });
    persistScopeImprovementState(scope, scopeState);
    const secondChange = {
      automatic: true,
      boundary: "content-policy-changed" as const,
      fingerprint: secondFingerprint,
      deliveryAttempt: 0,
      idempotencyKey: scopeImprovementDispatchKey(scopeId, secondFingerprint, 0),
    };
    pbus.emit(scopeImprovementChanged, secondChange);
    pbus.emit(scopeImprovementChanged, firstChange);
    await runtime.stop();

    const pending = runtime.getState().pendingRuns;
    expect(pending).toHaveLength(3);
    expect(pending.map((run) => run.trigger.payload.reason)).toEqual(
      expect.arrayContaining(["owner request one", "owner request two"]),
    );
    expect(pending).toContainEqual(
      expect.objectContaining({
        trigger: expect.objectContaining({
          payload: expect.objectContaining({
            automatic: true,
            fingerprint: "scope-content:second",
          }),
        }),
      }),
    );
  });

  it("rejects consumed progress revisions and scope fingerprints before queue insertion", async () => {
    const events = initModuleEventRegistry();
    events.register("autonomy", automaticProgressReviewRequested);
    events.register("autonomy", scopeImprovementChanged);

    const progress = runtimeFor(progressReviewerWorkflow);
    const progressScopeId = deriveDirectoryScopeId(progress.workspaceRoot);
    const progressPayload = {
      automatic: true,
      boundary: "parked-queue" as const,
      inputRevision: 1,
      deliveryAttempt: 0,
      idempotencyKey: progressReviewDispatchKey(progressScopeId, 1, 0),
    };
    persistScopeState(
      progress,
      PROGRESS_REVIEW_STATE_KEY,
      {
        schemaVersion: 1,
        scopeId: progressScopeId,
        lastConsumedRevision: 1,
        consumedAt: "2026-08-15T12:00:00.000Z",
      } satisfies ProgressReviewConsumptionState,
    );
    progress.pbus.emit(automaticProgressReviewRequested, progressPayload);
    await progress.runtime.stop();
    expect(progress.runtime.getState().pendingRuns).toEqual([]);

    const scope = runtimeFor(scopeImproverWorkflow);
    const scopeId = deriveDirectoryScopeId(scope.workspaceRoot);
    const fingerprint = "scope-content:consumed";
    persistScopeImprovementState(scope, {
      scopeId,
      lastRunAt: "2026-08-15T12:00:00.000Z",
      consumedFingerprint: fingerprint,
      pendingFingerprint: null,
      pendingBoundary: null,
      pendingDelivery: null,
      pendingDeliveryAttempt: 0,
      recentSignatures: [],
    });
    scope.pbus.emit(scopeImprovementChanged, {
      automatic: true,
      boundary: "content-policy-changed",
      fingerprint,
      deliveryAttempt: 0,
      idempotencyKey: scopeImprovementDispatchKey(scopeId, fingerprint, 0),
    });
    await scope.runtime.stop();
    expect(scope.runtime.getState().pendingRuns).toEqual([]);
  });
});
