import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EventJournal } from "#core/events/event-journal.js";
import { redactSensitiveText } from "#core/evidence/policy.js";
import {
  activeAgentStepIds,
  daemonHostControlDenialCount,
  finishControlCoverageFamilies,
  matchingCoverageEvents,
  newControlCoverageFamily,
} from "./control-monitor-coverage-aggregate.js";
import {
  inspectAgentStream,
  inspectApprovalOwnerGates,
  inspectAsyncReviewers,
  inspectAutonomyMode,
  inspectInjectionDefense,
  inspectRuntimeProbe,
  inspectToolPolicy,
  inspectTrajectory,
} from "./control-monitor-coverage-inspectors.js";
import {
  artifactRef,
  currentHeadSha,
  journalEventsForRun,
  readJsonlEvents,
  readJsonObject,
  runArtifactRef,
  snapshotStepsFrom,
  telemetryCalls,
} from "./control-monitor-coverage-readers.js";
import { average } from "./control-monitor-coverage-reviewers.js";
import { inspectTokenBudget } from "./control-monitor-coverage-token-budget.js";
import {
  CONTENT_INGEST_TOOL_NAMES,
  CONTROL_MONITOR_COVERAGE_ARTIFACT,
  CONTROL_MONITOR_COVERAGE_SCHEMA_VERSION,
  type ControlCoverageFamilyBuilder,
  type ControlCoverageFamilyName,
  type ControlCoverageGap,
  type ControlMonitorCoverageArtifact,
} from "./control-monitor-coverage-types.js";
import { writeJsonFile } from "./run-io.js";
import type { WorkflowRunMetadata } from "./run-types.js";

export {
  CONTROL_MONITOR_COVERAGE_ARTIFACT,
  CONTROL_MONITOR_COVERAGE_SCHEMA_VERSION,
  type ControlCoverageFamily,
  type ControlCoverageFamilyName,
  type ControlCoverageGap,
  type ControlCoverageStatus,
  type ControlMonitorCoverageArtifact,
} from "./control-monitor-coverage-types.js";

export type BuildControlMonitorCoverageOptions = {
  projectDir: string;
  runDirPath: string;
  metadata: WorkflowRunMetadata;
  eventJournal?: EventJournal;
  nowIso?: string;
  headSha?: string | null;
};

export type WriteControlMonitorCoverageBestEffortOptions =
  Omit<BuildControlMonitorCoverageOptions, "eventJournal"> & {
    errorArtifact: string;
    errorRunDirPath?: string;
  };

export function buildControlMonitorCoverageArtifact(
  options: BuildControlMonitorCoverageOptions,
): ControlMonitorCoverageArtifact {
  const { projectDir, runDirPath, metadata } = options;
  const generatedAt = options.nowIso ?? new Date().toISOString();
  const workflowSnapshot = readJsonObject(join(runDirPath, "workflow.json"));
  const snapshotSteps = snapshotStepsFrom(workflowSnapshot);
  const snapshotById = new Map(snapshotSteps.map((step) => [step.id, step]));
  const families = new Map<ControlCoverageFamilyName, ControlCoverageFamilyBuilder>();
  const gaps: ControlCoverageGap[] = [];
  const family = (name: ControlCoverageFamilyName) => {
    const current = families.get(name) ?? newControlCoverageFamily(name);
    families.set(name, current);
    return current;
  };
  const addGap = (
    familyName: ControlCoverageFamilyName,
    reason: string,
    subject: string,
    evidenceRefs: string[],
    severity: "warning" | "error" = "warning",
  ) => {
    const id = `${familyName}:${reason}:${gaps.length + 1}`;
    gaps.push({ id, family: familyName, severity, reason, subject, evidenceRefs });
    const target = family(familyName);
    target.gapIds.push(id);
    if (reason.startsWith("unsupported")) target.unsupported += 1;
  };

  const events = [
    ...readJsonlEvents(join(runDirPath, "emitted-events.jsonl"), projectDir),
    ...journalEventsForRun({
      eventJournal: options.eventJournal,
      metadata,
      projectDir,
      runDirPath,
    }),
  ];
  const guardrailEvents = matchingCoverageEvents(events, "guardrail.assessed");
  const injectionEvents = matchingCoverageEvents(events, "injection.defense.assessed");
  const approvalRequestedEvents = matchingCoverageEvents(events, "approval.requested");
  const approvalResolvedEvents = matchingCoverageEvents(events, "approval.resolved");
  const agentStepIds = activeAgentStepIds(metadata, snapshotSteps, runDirPath);
  const approvalSteps = metadata.steps.filter((step) =>
    step.type === "approval" && step.status !== "skipped"
  );
  const ownerWaitSteps = metadata.steps.filter((step) => {
    const snapshot = snapshotById.get(step.id);
    return (
      step.type === "await-event" &&
      step.status !== "skipped" &&
      snapshot?.event === "owner.question.resolved"
    );
  });
  let toolCalls = 0;
  let externalPayloadIngests = 0;
  const toolCallTools: string[] = [];
  const externalPayloadTools: string[] = [];

  for (const stepId of agentStepIds) {
    inspectAgentStream({ projectDir, runDirPath, stepId, family, addGap });
    inspectAutonomyMode({ projectDir, runDirPath, stepId, mode: snapshotById.get(stepId)?.autonomyMode ?? null, family, addGap });
    inspectTrajectory({ projectDir, runDirPath, stepId, family, addGap });
    inspectTokenBudget({
      projectDir,
      runDirPath,
      stepId,
      maxTotalTokens: snapshotById.get(stepId)?.tokenBudgetMaxTotalTokens ?? null,
      family,
      addGap,
    });
    const telemetryPath = join(runDirPath, "steps", `${stepId}.tool-telemetry.json`);
    const calls = telemetryCalls(telemetryPath);
    toolCalls += calls.length;
    toolCallTools.push(...calls.map((call) => call.tool));
    for (const call of calls) {
      if (call.externalContent || CONTENT_INGEST_TOOL_NAMES.has(call.tool)) {
        externalPayloadIngests += 1;
        externalPayloadTools.push(call.tool);
      }
    }
    if (calls.length > 0) family("tool-policy").evidenceRefs.push(artifactRef(projectDir, telemetryPath));
  }

  inspectToolPolicy({
    projectDir,
    runDirPath,
    toolCallTools,
    guardrailEvents,
    family,
    addGap,
  });
  inspectInjectionDefense({
    projectDir,
    runDirPath,
    externalPayloadTools,
    injectionEvents,
    family,
    addGap,
  });
  const approvalRequestCount = inspectApprovalOwnerGates({
    projectDir,
    runDirPath,
    steps: [...approvalSteps, ...ownerWaitSteps],
    approvalRequestedEvents,
    approvalResolvedEvents,
    family,
    addGap,
  });
  const runtimeProbeCount = inspectRuntimeProbe({ projectDir, runDirPath, family });
  const links = inspectAsyncReviewers({ projectDir, runDirPath, metadata, family });

  const completedFamilies = finishControlCoverageFamilies(families);
  const denominator = completedFamilies.reduce((sum, item) => sum + item.denominator, 0);
  const numerator = completedFamilies.reduce((sum, item) => sum + item.numerator, 0);
  const pendingCount = completedFamilies.reduce((sum, item) => sum + item.pending, 0);
  const unsupportedCount = gaps.filter((gap) =>
    gap.reason.startsWith("unsupported")
  ).length;
  const blockedCount = completedFamilies.reduce((sum, item) => sum + item.blocked, 0);
  const warnedCount = completedFamilies.reduce((sum, item) => sum + item.warned, 0);

  return {
    schemaVersion: CONTROL_MONITOR_COVERAGE_SCHEMA_VERSION,
    generatedAt,
    artifactPath: runArtifactRef(projectDir, runDirPath, CONTROL_MONITOR_COVERAGE_ARTIFACT),
    run: {
      id: metadata.id,
      workflow: metadata.workflow,
      triggerEvent: metadata.trigger.event,
      status: metadata.status,
      startedAt: metadata.startedAt,
      completedAt: metadata.completedAt ?? null,
      headSha: currentHeadSha(projectDir, options.headSha),
    },
    monitoredSurfaceCounts: {
      agentSteps: agentStepIds.length,
      toolCalls,
      externalPayloadIngests,
      approvalRequests: approvalRequestCount,
      ownerQuestionWaits: ownerWaitSteps.length,
      daemonHostControlDenials: daemonHostControlDenialCount(guardrailEvents),
      runtimeProbes: runtimeProbeCount,
      postRunReviewLinks: links.evidenceRefs.length,
    },
    summary: {
      numerator,
      denominator,
      gapCount: gaps.length,
      unsupportedCount,
      pendingCount,
      blockedCount,
      warnedCount,
    },
    families: completedFamilies,
    gaps,
    asyncReviewResponseMs: {
      observations: links.responseTimes.length,
      min: links.responseTimes.length > 0 ? Math.min(...links.responseTimes) : null,
      max: links.responseTimes.length > 0 ? Math.max(...links.responseTimes) : null,
      average: average(links.responseTimes),
    },
  };
}

export function writeControlMonitorCoverageArtifact(
  options: BuildControlMonitorCoverageOptions,
): ControlMonitorCoverageArtifact {
  const artifact = buildControlMonitorCoverageArtifact(options);
  writeJsonFile(join(options.runDirPath, CONTROL_MONITOR_COVERAGE_ARTIFACT), artifact);
  return artifact;
}

export function writeControlMonitorCoverageArtifactBestEffort(
  options: WriteControlMonitorCoverageBestEffortOptions,
): ControlMonitorCoverageArtifact | null {
  try {
    const eventJournal = persistedEventJournal(options.projectDir);
    return writeControlMonitorCoverageArtifact({
      projectDir: options.projectDir,
      runDirPath: options.runDirPath,
      metadata: options.metadata,
      ...(eventJournal !== undefined ? { eventJournal } : {}),
      ...(options.nowIso !== undefined ? { nowIso: options.nowIso } : {}),
      ...(options.headSha !== undefined ? { headSha: options.headSha } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeFileSync(
      join(options.errorRunDirPath ?? options.runDirPath, options.errorArtifact),
      redactSensitiveText(message),
      "utf-8",
    );
    return null;
  }
}

function persistedEventJournal(projectDir: string): EventJournal | undefined {
  const journalDir = join(projectDir, ".kota", "events");
  if (!existsSync(join(journalDir, "journal.jsonl"))) return undefined;
  return new EventJournal(journalDir);
}
