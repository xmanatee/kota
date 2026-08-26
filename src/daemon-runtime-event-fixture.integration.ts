import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createWorkflowDispatchDeadLetter,
} from "#core/daemon/dead-letter-queue.js";
import type { DaemonRuntimeScope } from "#core/daemon/runtime-scope-provider.js";
import type { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { AUTONOMY_ISSUE_PROJECTION_FILE } from "#modules/autonomy/autonomy-issue-projection.js";
import {
  type AutonomyHealthSignal,
  autonomyHealthSignal,
} from "#modules/autonomy/health-signal.js";

const FIXTURE_TIME = "2026-08-14T09:00:00.000Z";

export const AUTONOMY_SOURCE_EVENT_NAMES = [
  "workflow.failure.alert",
  "workflow.step.completed",
  "owner.question.changed",
  "workflow.dead-letter.changed",
  "workflow.interrupted.alert",
] as const;

export type ScopedAutonomyHealthSignal = AutonomyHealthSignal & {
  scopeId: string;
};

function interruptedBuilderRun(id: string): WorkflowRunMetadata {
  return {
    id,
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: {},
    },
    startedAt: FIXTURE_TIME,
    completedAt: FIXTURE_TIME,
    status: "interrupted",
    durationMs: 1000,
    runDir: `.kota/runs/${id}`,
    steps: [],
  };
}

function writeRun(scope: DaemonRuntimeScope, metadata: WorkflowRunMetadata): string {
  const path = join(scope.runStore.runsDir, metadata.id, "metadata.json");
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(metadata), "utf-8");
  return path;
}

export type RuntimeSourceFixture = ReturnType<typeof createRuntimeSourceFixture>;

export function createRuntimeSourceFixture(args: {
  bus: EventBus;
  scope: DaemonRuntimeScope;
  tag: string;
}) {
  const { bus, scope, tag } = args;
  const scopeId = scope.scope.scopeId;
  const scopeRoot = scope.scope.scopeRoot;
  const pbus = new ScopedEventBus(bus, scopeId);
  const reviewRunId = `review-${tag}`;
  const trajectoryRunId = `trajectory-${tag}`;
  const interruptionRunId = `builder-interrupted-${tag}`;
  const reviewPath = join(
    scopeRoot,
    ".kota",
    "runs",
    reviewRunId,
    "review-scrutiny.json",
  );
  const trajectoryPath = join(
    scopeRoot,
    ".kota",
    "runs",
    trajectoryRunId,
    "steps",
    "build.trajectory-diagnostics.json",
  );
  let ownerQuestionPath: string | null = null;

  return {
    scopeId,
    scopeRoot,
    emitFailure(errorSummary = `${tag} daemon runtime integration failure`): void {
      pbus.emit("workflow.failure.alert", {
        workflow: "builder",
        runId: `failure-${tag}`,
        status: "failed",
        durationMs: 1000,
        errorSummary,
        text: "builder failed",
      });
    },
    emitReview(): void {
      mkdirSync(join(reviewPath, ".."), { recursive: true });
      writeFileSync(reviewPath, JSON.stringify({
        runId: reviewRunId,
        workflow: "builder",
        surface: "critic",
        taskId: `task-${tag}`,
        thinAcceptance: true,
        generatedAt: FIXTURE_TIME,
      }), "utf-8");
      pbus.emit("workflow.step.completed", {
        workflow: "builder",
        runId: reviewRunId,
        stepId: "critic",
        stepType: "code",
        status: "success",
        durationMs: 100,
        runDir: `.kota/runs/${reviewRunId}`,
        definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      });
    },
    emitTrajectory(): void {
      mkdirSync(join(trajectoryPath, ".."), { recursive: true });
      writeFileSync(trajectoryPath, JSON.stringify({
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
          summary: `${tag} missed final verification.`,
          frameIndexes: [3],
          details: ["lastEditFrame=3"],
        }],
      }), "utf-8");
      pbus.emit("workflow.step.completed", {
        workflow: "builder",
        runId: trajectoryRunId,
        stepId: "build",
        stepType: "agent",
        status: "success",
        durationMs: 100,
        runDir: `.kota/runs/${trajectoryRunId}`,
        definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
        trajectoryDiagnostics: {
          artifactPath: `.kota/runs/${trajectoryRunId}/steps/build.trajectory-diagnostics.json`,
          warningCount: 1,
          unsupportedTrajectoryCount: 0,
          missingStreamingFramesCount: 0,
          missingFinalVerificationAfterEditCount: 1,
          repeatedIdenticalFailingCommandCount: 0,
          editAfterSuccessfulVerificationCount: 0,
          longPreambleWithoutTaskTouchCount: 0,
        },
      });
    },
    emitOwnerAnswer(): void {
      const question = scope.ownerQuestionQueue.enqueue({
        dedupeKey: `${tag}-owner-decision`,
        context: `Only scope ${tag} owns this decision.`,
        question: `Choose the scope ${tag} recovery path?`,
        reason: "The repository cannot infer the owner policy.",
        source: `daemon-runtime-${tag}`,
        answerBehavior: "record-only",
        origin: { kind: "manual", source: "daemon-runtime-fixture" },
      });
      ownerQuestionPath = join(
        scopeRoot,
        ".kota",
        "owner-questions",
        `${question.id}.json`,
      );
      scope.ownerQuestionQueue.answer(question.id, `Preserve ${tag} work`, "test");
    },
    emitDeadLetter(): void {
      createWorkflowDispatchDeadLetter({
        store: scope.deadLetterQueue,
        scopeId,
        workflowName: "progress-reviewer",
        trigger: {
          event: "autonomy.progress-review.requested",
          schemaRef: null,
          payload: {},
        },
        reason: `${tag} progress review dispatch failed`,
        errorClass: "execution",
        failedRun: {
          ...interruptedBuilderRun(`review-failure-${tag}`),
          workflow: "progress-reviewer",
          status: "failed",
        },
      });
    },
    emitBuilderInterruption(): void {
      writeRun(scope, interruptedBuilderRun(interruptionRunId));
      pbus.emit("workflow.interrupted.alert", {
        workflow: "builder",
        runId: interruptionRunId,
        durationMs: 1000,
        reason: "daemon restart",
        text: "builder interrupted",
      });
    },
    snapshotSourceStores(): Record<string, string> {
      if (ownerQuestionPath === null) {
        throw new Error(`scope ${scopeId} has no owner-question fixture`);
      }
      const paths = [
        join(scopeRoot, AUTONOMY_ISSUE_PROJECTION_FILE),
        join(scopeRoot, ".kota", "dead-letter-queue", "items.json"),
        ownerQuestionPath,
        join(scope.runStore.runsDir, interruptionRunId, "metadata.json"),
        reviewPath,
        trajectoryPath,
      ];
      return Object.fromEntries(paths.map((path) => [
        path.slice(scopeRoot.length + 1),
        readFileSync(path, "utf-8"),
      ]));
    },
  };
}

export function flushCapturedWarningBatch(
  bus: EventBus,
  signal: ScopedAutonomyHealthSignal,
): void {
  for (let index = 1; index < 5; index++) {
    bus.emit(autonomyHealthSignal, signal);
  }
}
