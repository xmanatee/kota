import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import {
  initModuleEventRegistry,
  resetModuleEventRegistry,
} from "#core/events/module-event.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { WorkflowRuntime } from "#core/workflow/runtime.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinitionInput,
} from "#core/workflow/types.js";
import {
  automaticProgressReviewRequested,
  progressReviewRequested,
} from "../progress-reviewer/events.js";
import {
  inspectProgressReviewSemanticInput,
  progressReviewDispatchKey,
  recordProgressReviewInputQueued,
  recordProgressReviewSemanticInput,
} from "../progress-reviewer/semantic-input.js";
import progressReviewerWorkflow from "../progress-reviewer/workflow.js";
import {
  scopeImprovementChanged,
  scopeImprovementRequested,
} from "../scope-improver/events.js";
import { writePendingScopeFingerprint } from "../scope-improver/scope-improvement-state.js";
import { SCOPE_IMPROVEMENT_STATE_PATH } from "../scope-improver/scope-improvement-types.js";
import { scopeImprovementDispatchKey } from "../scope-improver/semantic-request.js";
import scopeImproverWorkflow from "../scope-improver/workflow.js";

function queueOnlyWorkflow(
  workflow: WorkflowDefinitionInput,
): RegisteredWorkflowDefinitionInput {
  return {
    name: workflow.name,
    description: workflow.description,
    triggerAdmission: workflow.triggerAdmission,
    definitionPath: `semantic-request-queue:${workflow.name}`,
    moduleRoot: process.cwd(),
    triggers: workflow.triggers.filter(
      (trigger) => trigger.event !== "runtime.recovered",
    ),
    steps: [{ id: "noop", type: "code", run: () => ({ ok: true }) }],
  };
}

describe("semantic review request queue isolation", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    resetModuleEventRegistry();
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  function runtimeFor(workflow: WorkflowDefinitionInput) {
    const projectDir = mkdtempSync(join(tmpdir(), "kota-semantic-request-queue-"));
    projectDirs.push(projectDir);
    mkdirSync(join(projectDir, ".kota"), { recursive: true });
    const bus = new EventBus();
    const runtime = new WorkflowRuntime({
      bus,
      projectDir,
      idleIntervalMs: 60_000,
      workflows: [queueOnlyWorkflow(workflow)],
    });
    const pbus = new ProjectScopedEventBus(
      bus,
      deriveDirectoryScopeId(projectDir),
    );
    runtime.start();
    runtime.setDispatchPaused(true);
    return { runtime, pbus, projectDir };
  }

  it("preserves every explicit progress request beside one latest automatic revision", async () => {
    const events = initModuleEventRegistry();
    events.register("autonomy", progressReviewRequested);
    events.register("autonomy", automaticProgressReviewRequested);
    const { runtime, pbus, projectDir } = runtimeFor(progressReviewerWorkflow);
    const scopeId = deriveDirectoryScopeId(projectDir);

    pbus.emit(progressReviewRequested, { reason: "owner request one" });
    pbus.emit(progressReviewRequested, { reason: "owner request two" });
    const revisionOne = {
      automatic: true,
      boundary: "parked-queue" as const,
      inputRevision: 1,
      deliveryAttempt: 0,
      idempotencyKey: progressReviewDispatchKey(scopeId, 1, 0),
    };
    recordProgressReviewInputQueued({ projectDir, payload: revisionOne });
    pbus.emit(automaticProgressReviewRequested, revisionOne);
    const revisionTwo = {
      automatic: true,
      boundary: "strategic-completion" as const,
      inputRevision: 2,
      deliveryAttempt: 0,
      idempotencyKey: progressReviewDispatchKey(scopeId, 2, 0),
    };
    recordProgressReviewInputQueued({ projectDir, payload: revisionTwo });
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
    const { runtime, pbus, projectDir } = runtimeFor(scopeImproverWorkflow);
    const scopeId = deriveDirectoryScopeId(projectDir);

    pbus.emit(scopeImprovementRequested, { reason: "owner request one" });
    pbus.emit(scopeImprovementRequested, { reason: "owner request two" });
    const firstFingerprint = "scope-content:first";
    writePendingScopeFingerprint({
      projectDir,
      scopeId,
      fingerprint: firstFingerprint,
      boundary: "content-policy-changed",
      delivery: "queued",
      deliveryAttempt: 0,
    });
    const firstChange = {
      automatic: true,
      boundary: "content-policy-changed" as const,
      fingerprint: firstFingerprint,
      deliveryAttempt: 0,
      idempotencyKey: scopeImprovementDispatchKey(scopeId, firstFingerprint, 0),
    };
    pbus.emit(scopeImprovementChanged, firstChange);
    const secondFingerprint = "scope-content:second";
    writePendingScopeFingerprint({
      projectDir,
      scopeId,
      fingerprint: secondFingerprint,
      boundary: "content-policy-changed",
      delivery: "queued",
      deliveryAttempt: 0,
    });
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
    expect(pending.map((run) => run.trigger.payload.reason)).toEqual([
      "owner request one",
      "owner request two",
      undefined,
    ]);
    expect(pending[2]?.trigger.payload).toMatchObject({
      automatic: true,
      fingerprint: "scope-content:second",
    });
  });

  it("rejects consumed progress revisions and scope fingerprints before queue insertion", async () => {
    const events = initModuleEventRegistry();
    events.register("autonomy", automaticProgressReviewRequested);
    events.register("autonomy", scopeImprovementChanged);

    const progress = runtimeFor(progressReviewerWorkflow);
    const progressScopeId = deriveDirectoryScopeId(progress.projectDir);
    const progressPayload = {
      automatic: true,
      boundary: "parked-queue" as const,
      inputRevision: 1,
      deliveryAttempt: 0,
      idempotencyKey: progressReviewDispatchKey(progressScopeId, 1, 0),
    };
    const progressInput = inspectProgressReviewSemanticInput({
      projectDir: progress.projectDir,
      trigger: {
        event: automaticProgressReviewRequested.name,
        schemaRef: null,
        payload: progressPayload,
      },
    });
    recordProgressReviewSemanticInput({
      projectDir: progress.projectDir,
      input: progressInput,
      consumedAt: "2026-08-15T12:00:00.000Z",
    });
    progress.pbus.emit(automaticProgressReviewRequested, progressPayload);
    await progress.runtime.stop();
    expect(progress.runtime.getState().pendingRuns).toEqual([]);

    const scope = runtimeFor(scopeImproverWorkflow);
    const scopeId = deriveDirectoryScopeId(scope.projectDir);
    const fingerprint = "scope-content:consumed";
    const statePath = join(scope.projectDir, SCOPE_IMPROVEMENT_STATE_PATH);
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, JSON.stringify({
      scopeId,
      lastRunAt: "2026-08-15T12:00:00.000Z",
      consumedFingerprint: fingerprint,
      pendingFingerprint: null,
      pendingBoundary: null,
      pendingDelivery: null,
      pendingDeliveryAttempt: 0,
      recentSignatures: [],
    }));
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
