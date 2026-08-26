import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/usage.js";
import type { WorkflowStepErrorKind } from "#core/workflow/run-types.js";

export type StepSeed = {
  id: string;
  type: "agent" | "approval" | "await-event" | "code";
  status: "success" | "failed" | "skipped";
  event?: string;
  error?: string;
  errorKind?: WorkflowStepErrorKind;
};

export function readyTaskPath(projectDir: string, taskId: string): string {
  return join(projectDir, "data", "tasks", "ready", `${taskId}.md`);
}

export function writeRunWithCoverage(
  projectDir: string,
  id: string,
  startedAt: string,
): void {
  const runDir = join(projectDir, ".kota", "runs", id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "metadata.json"),
    JSON.stringify({
      id,
      workflow: "builder",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      trigger: {
        event: "autonomy.queue.available",
        schemaRef: null,
        payload: {},
      },
      status: "success",
      startedAt,
      completedAt: startedAt,
      durationMs: 1000,
      runDir: `.kota/runs/${id}`,
      steps: [],
    }),
    "utf-8",
  );
  writeFileSync(
    join(runDir, "control-monitor-coverage.json"),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: startedAt,
      artifactPath: `.kota/runs/${id}/control-monitor-coverage.json`,
      run: {
        id,
        workflow: "builder",
        triggerEvent: "autonomy.queue.available",
        status: "success",
        startedAt,
        completedAt: startedAt,
        headSha: "abc123",
      },
      monitoredSurfaceCounts: {
        agentSteps: 1,
        toolCalls: 1,
        externalPayloadIngests: 1,
        approvalRequests: 0,
        ownerQuestionWaits: 0,
        daemonHostControlDenials: 0,
        runtimeProbes: 0,
        postRunReviewLinks: 0,
      },
      summary: {
        numerator: 3,
        denominator: 4,
        gapCount: 1,
        unsupportedCount: 0,
        pendingCount: 0,
        blockedCount: 0,
        warnedCount: 0,
      },
      families: [],
      gaps: [
        {
          id: "injection-defense:external-payload-unscreened:1",
          family: "injection-defense",
          severity: "error",
          reason: "external-payload-unscreened",
          subject: "1 external payload(s)",
          evidenceRefs: [`.kota/runs/${id}/metadata.json`],
        },
      ],
      asyncReviewResponseMs: {
        observations: 0,
        min: null,
        max: null,
        average: null,
      },
    }),
    "utf-8",
  );
}

export function writeRunWithUnknownCoverage(
  projectDir: string,
  id: string,
  startedAt: string,
): void {
  const runDir = join(projectDir, ".kota", "runs", id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "metadata.json"), JSON.stringify({
    id,
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: {
      event: "autonomy.queue.available",
      schemaRef: null,
      payload: {},
    },
    status: "interrupted",
    startedAt,
    completedAt: startedAt,
    durationMs: 1000,
    runDir: `.kota/runs/${id}`,
    steps: [],
  }));
  writeFileSync(join(runDir, "control-monitor-coverage.json"), JSON.stringify({
    schemaVersion: 3,
    generatedAt: startedAt,
    artifactPath: `.kota/runs/${id}/control-monitor-coverage.json`,
    run: {
      id,
      workflow: "builder",
      triggerEvent: "autonomy.queue.available",
      status: "interrupted",
      startedAt,
      completedAt: startedAt,
      headSha: "abc123",
    },
    monitoredSurfaceCounts: {
      agentSteps: 1,
      toolCalls: 0,
      externalPayloadIngests: 0,
      approvalRequests: 0,
      ownerQuestionWaits: 0,
      daemonHostControlDenials: 0,
      runtimeProbes: 0,
      postRunReviewLinks: 0,
    },
    summary: {
      numerator: 0,
      denominator: 1,
      gapCount: 0,
      unsupportedCount: 0,
      unavailableCount: 0,
      unknownCount: 1,
      pendingCount: 0,
      blockedCount: 0,
      warnedCount: 0,
    },
    families: [],
    gaps: [],
    unknowns: [{
      id: "agent-step-stream:interrupted-before-agent-step-events-finalized:1",
      family: "agent-step-stream",
      reason: "interrupted-before-agent-step-events-finalized",
      subject: "build",
      evidenceRefs: [`.kota/runs/${id}/metadata.json`],
    }],
    asyncReviewResponseMs: { observations: 0, min: null, max: null, average: null },
  }));
}

function stepResult(step: StepSeed, startedAt: string) {
  return {
    id: step.id,
    type: step.type,
    status: step.status,
    startedAt,
    completedAt: startedAt,
    durationMs: 10,
    ...(step.status === "skipped"
      ? { skipReason: { kind: "when-predicate" } }
      : {}),
    ...(step.type === "agent" && step.status !== "skipped"
      ? { usage: UNKNOWN_AGENT_USAGE }
      : {}),
    ...(step.error ? { error: step.error } : {}),
    ...(step.errorKind ? { errorKind: step.errorKind } : {}),
  };
}

export function writeRunWithAgentRuntimeCoverageGaps(
  projectDir: string,
  args: {
    id: string;
    startedAt: string;
    error: string;
    errorKind?: WorkflowStepErrorKind;
  },
): void {
  const { id, startedAt } = args;
  const runDir = join(projectDir, ".kota", "runs", id);
  mkdirSync(runDir, { recursive: true });
  const step: StepSeed = {
    id: "review-evidence",
    type: "agent",
    status: "failed",
    error: args.error,
    ...(args.errorKind ? { errorKind: args.errorKind } : {}),
  };
  writeFileSync(
    join(runDir, "metadata.json"),
    JSON.stringify({
      id,
      workflow: "progress-reviewer",
      definitionPath:
        "src/modules/autonomy/workflows/progress-reviewer/workflow.ts",
      trigger: {
        event: "workflow.batch.flushed",
        schemaRef: null,
        payload: {},
      },
      status: "failed",
      startedAt,
      completedAt: startedAt,
      durationMs: 1000,
      runDir: `.kota/runs/${id}`,
      steps: [stepResult(step, startedAt)],
    }),
    "utf-8",
  );
  writeFileSync(
    join(runDir, "control-monitor-coverage.json"),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: startedAt,
      artifactPath: `.kota/runs/${id}/control-monitor-coverage.json`,
      run: {
        id,
        workflow: "progress-reviewer",
        triggerEvent: "workflow.batch.flushed",
        status: "failed",
        startedAt,
        completedAt: startedAt,
        headSha: "abc123",
      },
      monitoredSurfaceCounts: {
        agentSteps: 1,
        toolCalls: 0,
        externalPayloadIngests: 0,
        approvalRequests: 0,
        ownerQuestionWaits: 0,
        daemonHostControlDenials: 0,
        runtimeProbes: 0,
        postRunReviewLinks: 0,
      },
      summary: {
        numerator: 1,
        denominator: 3,
        gapCount: 2,
        unsupportedCount: 0,
        pendingCount: 0,
        blockedCount: 0,
        warnedCount: 0,
      },
      families: [],
      gaps: [
        {
          id: "agent-step-stream:missing-agent-step-events:1",
          family: "agent-step-stream",
          severity: "warning",
          reason: "missing-agent-step-events",
          subject: step.id,
          evidenceRefs: [
            `.kota/runs/${id}/steps/${step.id}.harness-capability.json`,
          ],
        },
        {
          id: "trajectory-diagnostics:missing-trajectory-diagnostics:2",
          family: "trajectory-diagnostics",
          severity: "warning",
          reason: "missing-trajectory-diagnostics",
          subject: step.id,
          evidenceRefs: [`.kota/runs/${id}/metadata.json`],
        },
      ],
      asyncReviewResponseMs: {
        observations: 0,
        min: null,
        max: null,
        average: null,
      },
    }),
    "utf-8",
  );
}

export function writeRunWithUnsupportedAgentStreamCoverageGaps(
  projectDir: string,
  id: string,
  startedAt: string,
): void {
  const runDir = join(projectDir, ".kota", "runs", id);
  mkdirSync(runDir, { recursive: true });
  const step: StepSeed = {
    id: "improve",
    type: "agent",
    status: "failed",
    error: 'Agent step "improve" failed: native harness stopped',
  };
  writeFileSync(
    join(runDir, "metadata.json"),
    JSON.stringify({
      id,
      workflow: "improver",
      definitionPath: "src/modules/autonomy/workflows/improver/workflow.ts",
      trigger: {
        event: "workflow.completed",
        schemaRef: null,
        payload: {},
      },
      status: "failed",
      startedAt,
      completedAt: startedAt,
      durationMs: 1000,
      runDir: `.kota/runs/${id}`,
      steps: [stepResult(step, startedAt)],
    }),
    "utf-8",
  );
  writeFileSync(
    join(runDir, "control-monitor-coverage.json"),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: startedAt,
      artifactPath: `.kota/runs/${id}/control-monitor-coverage.json`,
      run: {
        id,
        workflow: "improver",
        triggerEvent: "workflow.completed",
        status: "failed",
        startedAt,
        completedAt: startedAt,
        headSha: "abc123",
      },
      monitoredSurfaceCounts: {
        agentSteps: 1,
        toolCalls: 0,
        externalPayloadIngests: 0,
        approvalRequests: 0,
        ownerQuestionWaits: 0,
        daemonHostControlDenials: 0,
        runtimeProbes: 0,
        postRunReviewLinks: 0,
      },
      summary: {
        numerator: 1,
        denominator: 3,
        gapCount: 2,
        unsupportedCount: 2,
        pendingCount: 0,
        blockedCount: 0,
        warnedCount: 1,
      },
      families: [],
      gaps: [
        {
          id: "agent-step-stream:unsupported-agent-message-stream:1",
          family: "agent-step-stream",
          severity: "warning",
          reason: "unsupported-agent-message-stream",
          subject: step.id,
          evidenceRefs: [
            `.kota/runs/${id}/steps/${step.id}.harness-capability.json`,
          ],
        },
        {
          id: "trajectory-diagnostics:unsupported-trajectory-diagnostics:2",
          family: "trajectory-diagnostics",
          severity: "warning",
          reason: "unsupported-trajectory-diagnostics",
          subject: step.id,
          evidenceRefs: [
            `.kota/runs/${id}/steps/${step.id}.trajectory-diagnostics.json`,
          ],
        },
      ],
      asyncReviewResponseMs: {
        observations: 0,
        min: null,
        max: null,
        average: null,
      },
    }),
    "utf-8",
  );
}

export function writeRunWithApprovalOwnerGateGap(
  projectDir: string,
  args: {
    id: string;
    metadataId?: string;
    startedAt: string;
    step: StepSeed;
    evidenceRefs?: string[];
    stepArtifact?: StepSeed;
  },
): void {
  const { id, startedAt, step } = args;
  const runDir = join(projectDir, ".kota", "runs", id);
  const stepsDir = join(runDir, "steps");
  mkdirSync(stepsDir, { recursive: true });
  const stepArtifact = args.stepArtifact ?? step;
  writeFileSync(
    join(runDir, "metadata.json"),
    JSON.stringify({
      id: args.metadataId ?? id,
      workflow: "github-mention-intake",
      definitionPath:
        "src/modules/autonomy/workflows/github-mention-intake/workflow.ts",
      trigger: {
        event: "runtime.recovered",
        schemaRef: null,
        payload: {},
      },
      status: "success",
      startedAt,
      completedAt: startedAt,
      durationMs: 1000,
      runDir: `.kota/runs/${id}`,
      steps: [stepResult(step, startedAt)],
    }),
    "utf-8",
  );
  writeFileSync(
    join(runDir, "workflow.json"),
    JSON.stringify({
      steps: [
        {
          id: step.id,
          type: step.type,
          ...(step.event ? { event: step.event } : {}),
        },
      ],
    }),
    "utf-8",
  );
  writeFileSync(
    join(stepsDir, `${stepArtifact.id}.json`),
    JSON.stringify(stepResult(stepArtifact, startedAt)),
    "utf-8",
  );
  writeFileSync(
    join(runDir, "control-monitor-coverage.json"),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: startedAt,
      artifactPath: `.kota/runs/${id}/control-monitor-coverage.json`,
      run: {
        id,
        workflow: "github-mention-intake",
        triggerEvent: "runtime.recovered",
        status: "success",
        startedAt,
        completedAt: startedAt,
        headSha: "stale-before-skipped-gate-fix",
      },
      monitoredSurfaceCounts: {
        agentSteps: 0,
        toolCalls: 0,
        externalPayloadIngests: 0,
        approvalRequests: 1,
        ownerQuestionWaits: 0,
        daemonHostControlDenials: 0,
        runtimeProbes: 0,
        postRunReviewLinks: 0,
      },
      summary: {
        numerator: 0,
        denominator: 1,
        gapCount: 1,
        unsupportedCount: 0,
        pendingCount: 0,
        blockedCount: 1,
        warnedCount: 0,
      },
      families: [],
      gaps: [
        {
          id: "approval-owner-gates:approval-or-owner-gate-unresolved:1",
          family: "approval-owner-gates",
          severity: "warning",
          reason: "approval-or-owner-gate-unresolved",
          subject: step.id,
          evidenceRefs: args.evidenceRefs ?? [
            `.kota/runs/${id}/steps/${step.id}.json`,
          ],
        },
      ],
      asyncReviewResponseMs: {
        observations: 0,
        min: null,
        max: null,
        average: null,
      },
    }),
    "utf-8",
  );
}

export function writeRunWithSkippedApprovalGateGap(
  projectDir: string,
  id: string,
  startedAt: string,
): void {
  writeRunWithApprovalOwnerGateGap(projectDir, {
    id,
    startedAt,
    step: { id: "approve-comment", type: "approval", status: "skipped" },
  });
}

export function writeRunWithSkippedOwnerWaitGateGap(
  projectDir: string,
  id: string,
  startedAt: string,
): void {
  writeRunWithApprovalOwnerGateGap(projectDir, {
    id,
    startedAt,
    step: {
      id: "wait-owner",
      type: "await-event",
      status: "skipped",
      event: "owner.question.resolved",
    },
  });
}
