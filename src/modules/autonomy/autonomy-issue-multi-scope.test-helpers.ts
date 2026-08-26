import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import type { ProjectRuntime } from "#core/daemon/project-runtime.js";
import type { EventBus } from "#core/events/event-bus.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  materializeAutonomyIssueProjection,
  readAutonomyIssueProjection,
} from "./autonomy-issue-projection.js";
import { createTestProjectRuntime } from "./autonomy-runtime.test-helpers.js";
import type { AutonomyHealthSignal } from "./health-signal.js";
import {
  buildAutonomyHealthReviewFromSignals,
  applyAutonomyHealthReviewActions,
  planAutonomyHealthReviewActions,
} from "./workflows/autonomy-health-reviewer/health-review.js";

const NOW = "2026-08-14T09:00:00.000Z";

export type ScopedHealthSignal = AutonomyHealthSignal & {
  scopeId: string;
  projectId: string;
};

export function makeRuntime(
  projectDir: string,
  scopeId: string,
  bus: EventBus,
): ProjectRuntime {
  return createTestProjectRuntime({
    project: { projectId: scopeId, projectDir, displayName: scopeId },
    bus,
    onLog: () => {},
    installSingletons: false,
  });
}

export function writeRun(
  runtime: ProjectRuntime,
  metadata: WorkflowRunMetadata,
): void {
  const runDir = join(runtime.runStore.runsDir, metadata.id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "metadata.json"), JSON.stringify(metadata), "utf-8");
}

export function interruptedBuilderRun(id: string): WorkflowRunMetadata {
  return {
    id,
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: {},
    },
    startedAt: NOW,
    completedAt: NOW,
    status: "interrupted",
    durationMs: 1000,
    runDir: `.kota/runs/${id}`,
    steps: [],
  };
}

export function emitReview(runtime: ProjectRuntime, taskId: string): void {
  const runDir = join(runtime.project.projectDir, ".kota", "runs", "shared-review-run");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "review-scrutiny.json"),
    JSON.stringify({
      runId: "shared-review-run",
      workflow: "builder",
      surface: "critic",
      taskId,
      thinAcceptance: true,
      generatedAt: NOW,
    }),
    "utf-8",
  );
  runtime.pbus.emit("workflow.step.completed", {
    workflow: "builder",
    runId: "shared-review-run",
    stepId: "critic",
    stepType: "code",
    status: "success",
    durationMs: 100,
    runDir,
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
  });
}

export function emitTrajectory(runtime: ProjectRuntime): void {
  const artifactPath = join(
    runtime.project.projectDir,
    ".kota/runs/trajectory-run/steps/build.trajectory-diagnostics.json",
  );
  mkdirSync(join(artifactPath, ".."), { recursive: true });
  writeFileSync(artifactPath, JSON.stringify({
    version: 1,
    status: "supported",
    emitsAgentMessageStream: true,
    counts: {
      warningCount: 1,
      unsupportedTrajectoryCount: 0,
      missingStreamingFramesCount: 0,
      missingFinalVerificationAfterEditCount: 1,
      repeatedIdenticalFailingCommandCount: 0,
      editAfterSuccessfulVerificationCount: 0,
      longPreambleWithoutTaskTouchCount: 0,
    },
    diagnostics: [{
      code: "missing_final_verification_after_edit",
      severity: "warning",
      summary: `${runtime.project.projectId} missed final verification.`,
      frameIndexes: [3],
      details: ["lastEditFrame=3"],
    }],
  }), "utf-8");
  runtime.pbus.emit("workflow.step.completed", {
    workflow: "builder",
    runId: "trajectory-run",
    stepId: "build",
    stepType: "agent",
    status: "success",
    durationMs: 100,
    runDir: ".kota/runs/trajectory-run",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trajectoryDiagnostics: {
      artifactPath,
      warningCount: 1,
      unsupportedTrajectoryCount: 0,
      missingStreamingFramesCount: 0,
      missingFinalVerificationAfterEditCount: 1,
      repeatedIdenticalFailingCommandCount: 0,
      editAfterSuccessfulVerificationCount: 0,
      longPreambleWithoutTaskTouchCount: 0,
    },
  });
}

export function applyScopeSignals(
  projectDir: string,
  signals: readonly ScopedHealthSignal[],
): void {
  const review = buildAutonomyHealthReviewFromSignals({
    signals,
    generatedAt: NOW,
    sourceEventName: "autonomy.health.signal",
    reason: "multi-scope-runtime-fixture",
  });
  const currentProjection = readAutonomyIssueProjection(projectDir);
  const plannedActions = planAutonomyHealthReviewActions({
    projectDir,
    currentProjection,
    scopeDir: projectDir,
    review,
  });
  const finalized = applyAutonomyHealthReviewActions({
    currentProjection,
    scopeDir: projectDir,
    ownerQuestionQueue: new OwnerQuestionQueue(
      join(projectDir, ".kota", "owner-questions"),
    ),
    review,
    plannedActions,
  });
  materializeAutonomyIssueProjection(projectDir, finalized.projection);
}
