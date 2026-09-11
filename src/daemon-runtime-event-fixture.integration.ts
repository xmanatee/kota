import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createWorkflowDispatchDeadLetter,
} from "#core/daemon/dead-letter-queue.js";
import type { DaemonRuntimeScope } from "#core/daemon/runtime-scope-provider.js";
import type { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { AUTONOMY_ISSUE_PROJECTION_STATE_KEY } from "#modules/autonomy/autonomy-issue-projection.js";
import type {
  AutonomyHealthSignal,
} from "#modules/autonomy/health-signal.js";

const FIXTURE_TIME = "2026-08-14T09:00:00.000Z";

export const AUTONOMY_SOURCE_EVENT_NAMES = [
  "eval-harness.regression.detected",
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
  const interruptionRunId = `builder-interrupted-${tag}`;
  let ownerQuestionPath: string | null = null;

  return {
    scopeId,
    scopeRoot,
    emitFailure(errorSummary = `${tag} daemon runtime integration failure`): void {
      createWorkflowDispatchDeadLetter({
        store: scope.deadLetterQueue,
        scopeId,
        workflowName: "builder",
        trigger: {
          event: "autonomy.queue.available",
          schemaRef: null,
          payload: {},
        },
        reason: errorSummary,
        errorClass: "execution",
        failedRun: {
          ...interruptedBuilderRun(`failure-${tag}`),
          status: "failed",
        },
      });
    },
    emitRegression(): void {
      pbus.emit("eval-harness.regression.detected", {
        baseline: { fixtureCount: 1, repeatCount: 3, passAtK: 1, passHatK: 1 },
        candidate: { fixtureCount: 1, repeatCount: 3, passAtK: 0, passHatK: 0 },
        noiseBandPercentagePoints: 5, dropPercentagePoints: 100,
        hostClass: `fixture-${tag}`,
        reason: `${tag} held-out behavior regressed`,
        runArtifactBaseDir: `.kota/runs/eval-${tag}`,
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
        join(scopeRoot, ".kota", "dead-letter-queue", "items.json"),
        ownerQuestionPath,
        join(scope.runStore.runsDir, interruptionRunId, "metadata.json"),
      ];
      return { projection: JSON.stringify(scope.runState.readScopeStateValue(scopeId, AUTONOMY_ISSUE_PROJECTION_STATE_KEY)), ...Object.fromEntries(paths.map((path) => [
        path.slice(scopeRoot.length + 1),
        readFileSync(path, "utf-8"),
      ])) };
    },
  };
}
