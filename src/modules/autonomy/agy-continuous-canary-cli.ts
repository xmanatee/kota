import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Command } from "commander";
import type {
  DeadLetterItem,
  WorkflowRunDetail,
} from "#core/daemon/daemon-control.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import { workflowUsesAgent } from "#core/workflow/run-executor-agent-usage.js";
import { validateWorkflowRunId } from "#core/workflow/run-io.js";
import type { WorkflowStep } from "#core/workflow/step-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import {
  readWriterIntegrationEvidence,
  type WriterIntegrationEvidence,
} from "#core/workflow/writer-integration-evidence.js";
import { writeJson } from "#modules/rendering/transport.js";
import { getValidatedWorkflowDefinitions } from "#modules/workflow-ops/definitions-source.js";
import {
  AGY_CANARY_PHASE_MINIMUM_MS,
  type AgyCanaryObservation,
  type AgyCanaryPhase,
  type AgyCanaryProviderIncident,
  type AgyCanaryQualityReview,
  assessAgyCanary,
  baselineCarriedAgyRunIds,
  parseAgyCanaryQualityReview,
  partitionAgyCanaryReviewRuns,
} from "./agy-continuous-canary.js";
import {
  collectAgyCanaryRunEvidence,
  materializeAgyCanaryFindingTask,
  qualityReviewPrompt,
} from "./agy-continuous-canary-evidence.js";

const CANARY_SCHEMA_VERSION = 4;
const MAX_CANARY_RUNS = 200;

type AgyCanaryCommandOptions = {
  runId: string;
  start?: boolean;
  phase?: string;
};

type AgyCanaryBaseline = {
  schemaVersion: typeof CANARY_SCHEMA_VERSION;
  artifactType: "agy-continuous-canary-baseline";
  runId: string;
  startedAt: string;
  agentRuntimeId: string;
  existingRunIds: string[];
  existingTaskIds: string[];
};

type AgyCanaryCheckpoint = {
  schemaVersion: typeof CANARY_SCHEMA_VERSION;
  artifactType: "agy-continuous-canary-checkpoint";
  runId: string;
  nextWindowStartedAt: string;
  completedWindows: number;
  carriedRunIds: string[];
  lastPhase?: AgyCanaryPhase;
};

function canaryRoot(cwd: string, runId: string): string {
  return join(cwd, ".kota", "runs", runId, "agy-continuous-canary");
}

function decodeBaseline(value: unknown, runId: string): AgyCanaryBaseline {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AGY canary baseline must be an object");
  }
  const input = value as Record<string, unknown>;
  if (
    input.schemaVersion !== CANARY_SCHEMA_VERSION ||
    input.artifactType !== "agy-continuous-canary-baseline" ||
    input.runId !== runId ||
    typeof input.startedAt !== "string" ||
    !Number.isFinite(Date.parse(input.startedAt)) ||
    typeof input.agentRuntimeId !== "string" ||
    !input.agentRuntimeId.endsWith(":antigravity-cli") ||
    !Array.isArray(input.existingRunIds) ||
    !input.existingRunIds.every((id) => typeof id === "string") ||
    !Array.isArray(input.existingTaskIds) ||
    !input.existingTaskIds.every((id) => typeof id === "string")
  ) {
    throw new Error("AGY canary baseline is invalid");
  }
  return input as AgyCanaryBaseline;
}

function decodeCheckpoint(value: unknown, runId: string): AgyCanaryCheckpoint {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AGY canary checkpoint must be an object");
  }
  const input = value as Record<string, unknown>;
  if (
    input.schemaVersion !== CANARY_SCHEMA_VERSION ||
    input.artifactType !== "agy-continuous-canary-checkpoint" ||
    input.runId !== runId ||
    typeof input.nextWindowStartedAt !== "string" ||
    !Number.isFinite(Date.parse(input.nextWindowStartedAt)) ||
    typeof input.completedWindows !== "number" ||
    !Number.isSafeInteger(input.completedWindows) ||
    input.completedWindows < 0 ||
    !Array.isArray(input.carriedRunIds) ||
    !input.carriedRunIds.every((id) => typeof id === "string") ||
    (input.lastPhase !== undefined && input.lastPhase !== "three-hour" &&
      input.lastPhase !== "six-hour")
  ) {
    throw new Error("AGY canary checkpoint is invalid");
  }
  return input as AgyCanaryCheckpoint;
}

function windowArtifactDir(
  root: string,
  phase: AgyCanaryPhase,
  startedAt: string,
  observedAt: string,
): string {
  const safe = (value: string) => value.replaceAll(":", "-");
  return join(root, phase, `${safe(startedAt)}--${safe(observedAt)}`);
}

function evidenceRef(cwd: string, path: string): string {
  return `artifact:${relative(cwd, path)}`;
}

export function observedAgyAgentRuns(
  runs: WorkflowRunDetail[],
  definitions: ReadonlyMap<string, WorkflowDefinition>,
): WorkflowRunDetail[] {
  return runs.filter((run) => {
    const definition = definitions.get(run.workflow);
    if (definition === undefined) {
      return run.steps.some((step) =>
        step.type === "agent" && step.status !== "skipped"
      );
    }
    const agentStepIds = new Set<string>();
    const visit = (steps: readonly WorkflowStep[]): void => {
      for (const step of steps) {
        if (
          step.type === "agent" ||
          (step.type === "code" && step.resolveAgentContract !== undefined)
        ) {
          agentStepIds.add(step.id);
        }
        if (step.type === "parallel" || step.type === "foreach") {
          visit(step.steps);
        } else if (step.type === "branch") {
          visit(step.ifTrue);
          visit(step.ifFalse);
        }
      }
    };
    visit(definition.steps);
    return run.steps.some((step) =>
      step.status !== "skipped" && agentStepIds.has(step.id)
    );
  });
}

export function agyCanaryProviderIncidents(
  items: DeadLetterItem[],
  status: Awaited<ReturnType<ModuleContext["client"]["workflow"]["status"]>>,
  windowStartedAt: string,
): AgyCanaryProviderIncident[] {
  const kinds = new Set([
    "rate_limit",
    "auth",
    "provider",
    "runtime",
    "output_contract",
  ]);
  const incidents = items
    .filter((item) =>
      kinds.has(item.failure.lastErrorClass) &&
      (Date.parse(item.failure.lastFailedAt) >= Date.parse(windowStartedAt) ||
        (item.failure.backoffUntil !== undefined &&
          Date.parse(item.failure.backoffUntil) > Date.parse(windowStartedAt)) ||
        (item.dismissedAt !== undefined &&
          Date.parse(item.dismissedAt) > Date.parse(windowStartedAt)))
    )
    .map((item): AgyCanaryProviderIncident => {
      const matchingBackoff = status.agentBackoff?.kind ===
          item.failure.lastErrorClass
        ? status.agentBackoff
        : status.agentBackoff?.retainedProviderIncident?.kind ===
            item.failure.lastErrorClass
          ? status.agentBackoff.retainedProviderIncident
          : undefined;
      const active = matchingBackoff !== undefined && item.status === "open";
      const windowObservationTimes = (item.failure.observationTimes ?? [])
        .filter((observedAt) =>
          Date.parse(observedAt) >= Date.parse(windowStartedAt)
        );
      return {
        fingerprint: item.id,
        kind: item.failure.lastErrorClass as AgyCanaryProviderIncident["kind"],
        observations: windowObservationTimes.length,
        active,
        firstObservedAt: item.failure.firstFailedAt,
        ...(item.failure.lastErrorClass === "output_contract" ? {} : {
          resetAt: active
            ? (matchingBackoff?.until ?? item.failure.backoffUntil ??
              item.failure.lastFailedAt)
            : (item.dismissedAt ?? item.failure.backoffUntil ??
              item.failure.lastFailedAt),
        }),
      };
    });
  const activeBackoffs = [
    status.agentBackoff,
    status.agentBackoff?.retainedProviderIncident,
  ].flatMap((backoff) => backoff === undefined ? [] : [backoff]);
  for (const active of activeBackoffs) {
    if (active.kind === "quality") continue;
    if (incidents.some((incident) =>
      incident.active && incident.kind === active.kind
    )) continue;
    incidents.push({
      fingerprint:
        `active:${active.runtimeId}:${active.kind}:${active.updatedAt}`,
      kind: active.kind,
      observations: Date.parse(active.updatedAt) >= Date.parse(windowStartedAt)
        ? 1
        : 0,
      active: true,
      firstObservedAt: active.updatedAt,
      ...(active.kind === "output_contract" ? {} : { resetAt: active.until }),
    });
  }
  return incidents;
}

export function agyCanaryProviderBackoffDurationMs(
  incidents: AgyCanaryProviderIncident[],
  startedAt: string,
  observedAt: string,
): number {
  const start = Date.parse(startedAt);
  const end = Date.parse(observedAt);
  const intervals = incidents.flatMap((incident): Array<[number, number]> => {
    if (incident.kind === "output_contract" || incident.resetAt === undefined) {
      return [];
    }
    const incidentStart = Math.max(
      start,
      incident.firstObservedAt === undefined
        ? start
        : Date.parse(incident.firstObservedAt),
    );
    const incidentEnd = Math.min(end, Date.parse(incident.resetAt));
    return incidentEnd > incidentStart ? [[incidentStart, incidentEnd]] : [];
  }).sort((left, right) => left[0] - right[0]);
  let total = 0;
  let cursorStart: number | undefined;
  let cursorEnd: number | undefined;
  for (const [intervalStart, intervalEnd] of intervals) {
    if (cursorStart === undefined || cursorEnd === undefined) {
      cursorStart = intervalStart;
      cursorEnd = intervalEnd;
    } else if (intervalStart <= cursorEnd) {
      cursorEnd = Math.max(cursorEnd, intervalEnd);
    } else {
      total += cursorEnd - cursorStart;
      cursorStart = intervalStart;
      cursorEnd = intervalEnd;
    }
  }
  return cursorStart === undefined || cursorEnd === undefined
    ? total
    : total + cursorEnd - cursorStart;
}

function readReviewDecision(path: string): "useful" | "not-useful" | null {
  if (!existsSync(path)) return null;
  try {
    const input = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    return input.verdict === "pass" || input.verdict === "pass_with_warnings"
      ? "useful"
      : "not-useful";
  } catch {
    return "not-useful";
  }
}

async function startCanary(
  ctx: ModuleContext,
  runId: string,
): Promise<AgyCanaryBaseline> {
  const root = canaryRoot(ctx.cwd, runId);
  const path = join(root, "baseline.json");
  if (existsSync(path)) {
    return decodeBaseline(JSON.parse(readFileSync(path, "utf8")), runId);
  }
  const [status, runs, tasks] = await Promise.all([
    ctx.client.workflow.status(),
    ctx.client.workflow.listRuns({ limit: MAX_CANARY_RUNS }),
    ctx.client.tasks.list(["open", "blocked"]),
  ]);
  const runtimeId = status.agentOperatingState?.runtimeId;
  if (runtimeId === undefined || !runtimeId.endsWith(":antigravity-cli")) {
    throw new Error(
      "agy-canary requires the live antigravity-cli agent runtime",
    );
  }
  const agentWorkflowNames = new Set(
    getValidatedWorkflowDefinitions(ctx)
      .filter(workflowUsesAgent)
      .map((definition) => definition.name),
  );
  const carriedRunIds = baselineCarriedAgyRunIds(
    runs.runs,
    agentWorkflowNames,
  );
  const baseline: AgyCanaryBaseline = {
    schemaVersion: CANARY_SCHEMA_VERSION,
    artifactType: "agy-continuous-canary-baseline",
    runId,
    startedAt: new Date().toISOString(),
    agentRuntimeId: runtimeId,
    existingRunIds: runs.runs.map((run) => run.id),
    existingTaskIds: tasks.tasks.map((task) => task.id),
  };
  mkdirSync(root, { recursive: true });
  writeJsonFileAtomic(path, baseline);
  writeJsonFileAtomic(join(root, "checkpoint.json"), {
    schemaVersion: CANARY_SCHEMA_VERSION,
    artifactType: "agy-continuous-canary-checkpoint",
    runId,
    nextWindowStartedAt: baseline.startedAt,
    completedWindows: 0,
    carriedRunIds,
  } satisfies AgyCanaryCheckpoint);
  return baseline;
}

async function observeCanary(
  ctx: ModuleContext,
  runId: string,
  phase: AgyCanaryPhase,
): Promise<Record<string, unknown>> {
  const root = canaryRoot(ctx.cwd, runId);
  const baselinePath = join(root, "baseline.json");
  if (!existsSync(baselinePath)) {
    throw new Error(
      `AGY canary baseline is missing; run agy-canary --run-id ${runId} --start first`,
    );
  }
  const baseline = decodeBaseline(
    JSON.parse(readFileSync(baselinePath, "utf8")),
    runId,
  );
  const checkpointPath = join(root, "checkpoint.json");
  if (!existsSync(checkpointPath)) {
    throw new Error("AGY canary checkpoint is missing");
  }
  const checkpoint = decodeCheckpoint(
    JSON.parse(readFileSync(checkpointPath, "utf8")),
    runId,
  );
  if (phase === "three-hour" && checkpoint.completedWindows !== 0) {
    throw new Error("The three-hour canary phase is only the first observation window");
  }
  if (phase === "six-hour" && checkpoint.completedWindows === 0) {
    throw new Error("Capture the three-hour canary window before a six-hour window");
  }
  const windowStartedAt = checkpoint.nextWindowStartedAt;
  const observedAt = new Date().toISOString();
  const elapsed = Date.parse(observedAt) - Date.parse(windowStartedAt);
  if (elapsed < AGY_CANARY_PHASE_MINIMUM_MS[phase]) {
    throw new Error(
      `${phase} observation is early by ${
        AGY_CANARY_PHASE_MINIMUM_MS[phase] - elapsed
      }ms`,
    );
  }
  const [initialStatus, listedRuns, tasks, deadLetters] = await Promise.all([
    ctx.client.workflow.status(),
    ctx.client.workflow.listRuns({ limit: MAX_CANARY_RUNS }),
    ctx.client.tasks.list(["open", "blocked"]),
    ctx.client.workflow.listDeadLetters({ limit: MAX_CANARY_RUNS }),
  ]);
  if (initialStatus.agentOperatingState?.runtimeId !== baseline.agentRuntimeId) {
    throw new Error("AGY canary agent runtime changed after the baseline");
  }
  if (listedRuns.runs.length >= MAX_CANARY_RUNS) {
    throw new Error(
      "AGY canary run window exceeds the complete evidence limit",
    );
  }
  const agentWorkflowDefinitions = new Map(
    getValidatedWorkflowDefinitions(ctx)
      .filter(workflowUsesAgent)
      .map((definition) => [definition.name, definition] as const),
  );
  const baselineRunIds = new Set(baseline.existingRunIds);
  const summaries = listedRuns.runs.filter(
    (run) =>
      !baselineRunIds.has(run.id) &&
      Date.parse(run.startedAt) >= Date.parse(windowStartedAt) &&
      Date.parse(run.startedAt) < Date.parse(observedAt),
  );
  const selectedRunIds = [...new Set([
    ...checkpoint.carriedRunIds,
    ...summaries.map((run) => run.id),
  ])];
  const detailResults = await Promise.all(
    selectedRunIds.map((id) => ctx.client.workflow.getRun(id)),
  );
  const missingRunIds = detailResults.flatMap((result, index) =>
    result.found ? [] : [selectedRunIds[index]!]
  );
  if (missingRunIds.length > 0) {
    throw new Error(
      `AGY canary could not resolve carried run evidence: ${missingRunIds.join(", ")}`,
    );
  }
  const details = detailResults.flatMap((result) =>
    result.found ? [result.run] : []
  );
  const previouslyCarriedRunIds = new Set(checkpoint.carriedRunIds);
  const selectedAgentRuns = details.filter((run) =>
    previouslyCarriedRunIds.has(run.id) ||
    agentWorkflowDefinitions.has(run.workflow) ||
    run.steps.some((step) => step.type === "agent")
  );
  let status = await ctx.client.workflow.status();
  if (status.agentOperatingState?.runtimeId !== baseline.agentRuntimeId) {
    throw new Error("AGY canary agent runtime changed during observation");
  }
  const reviewRuns = partitionAgyCanaryReviewRuns(
    selectedAgentRuns,
    observedAt,
    status.agentBackoff !== undefined,
  );
  const agentRuns = observedAgyAgentRuns(
    reviewRuns.reviewed,
    agentWorkflowDefinitions,
  );
  const activeRunIds = reviewRuns.active.map((run) => run.id);
  let pendingReviewRunIds = reviewRuns.pendingReview.map((run) => run.id);
  let carriedRunIds = [...new Set(reviewRuns.carried.map((run) => run.id))];
  const runsDir = join(ctx.cwd, ".kota", "runs");
  const outputDir = windowArtifactDir(
    root,
    phase,
    windowStartedAt,
    observedAt,
  );
  mkdirSync(outputDir, { recursive: true });
  const runEvidence = new Map<string, Set<string>>();
  const integrations: Array<
    { evidenceRef: string } & WriterIntegrationEvidence
  > = [];
  const diffScopeEvidence: string[] = [];
  for (const run of agentRuns) {
    const definition = agentWorkflowDefinitions.get(run.workflow);
    if (definition === undefined) {
      throw new Error(
        `Observed AGY run "${run.id}" has no active agent workflow definition`,
      );
    }
    const integration = readWriterIntegrationEvidence(runsDir, run.id);
    if (
      definition.repository === "write" &&
      (run.status === "success" || run.status === "completed-with-warnings") &&
      integration === null
    ) {
      throw new Error(
        `Observed writer run "${run.id}" has no writer-integration evidence`,
      );
    }
    if (integration !== null) {
      const path = join(runsDir, run.id, "writer-integration.json");
      integrations.push({
        evidenceRef: evidenceRef(ctx.cwd, path),
        ...integration,
      });
    }
    const taskId = run.triggerPayload?.taskId;
    const currentTaskContent = typeof taskId === "string"
      ? await ctx.client.tasks.show(taskId).then((result) =>
          result.found ? result.content : null
        )
      : null;
    const collected = collectAgyCanaryRunEvidence({
      ctx,
      run,
      definition,
      integration,
      runsDir,
      outputDir,
      currentTaskContent,
      evidenceRef: (path) => evidenceRef(ctx.cwd, path),
    });
    const refs = collected.refs;
    if (integration !== null) {
      refs.add(
        evidenceRef(ctx.cwd, join(runsDir, run.id, "writer-integration.json")),
      );
    }
    if (collected.diffScopeRef !== undefined) {
      diffScopeEvidence.push(collected.diffScopeRef);
    }
    const criticPath = join(runsDir, run.id, "critic-review.json");
    if (existsSync(criticPath)) refs.add(evidenceRef(ctx.cwd, criticPath));
    runEvidence.set(run.id, refs);
  }
  let incidents = agyCanaryProviderIncidents(
    deadLetters.items,
    status,
    windowStartedAt,
  );
  if (
    agentRuns.length === 0 && carriedRunIds.length === 0 &&
    incidents.length === 0
  ) {
    throw new Error(
      `${phase} observation contains neither AGY agent-run nor provider-incident evidence`,
    );
  }
  const packetPath = join(outputDir, "evidence.json");
  const packet = {
    schemaVersion: CANARY_SCHEMA_VERSION,
    artifactType: "agy-continuous-canary-evidence",
    runId,
    phase,
    canaryStartedAt: baseline.startedAt,
    windowStartedAt,
    observedAt,
    agentRuntimeId: baseline.agentRuntimeId,
    status,
    tasks: tasks.tasks,
    baselineTaskIds: baseline.existingTaskIds,
    runs: agentRuns,
    carriedRunIds,
    activeRuns: reviewRuns.active,
    pendingReviewRuns: reviewRuns.pendingReview,
    integrations,
    providerIncidents: incidents,
  };
  writeJsonFileAtomic(packetPath, packet);
  let suppressReview = agentRuns.length === 0;
  let review: AgyCanaryQualityReview = { runs: [], minorFindings: [] };
  if (!suppressReview) {
    try {
      const result = await ctx.client.sessions.runOneShot(
        qualityReviewPrompt(packetPath, runEvidence),
        { autonomyMode: "passive", agentBackoff: "scope" },
      );
      if (!result.ok) {
        throw new Error("A live daemon is required for the AGY canary review");
      }
      review = parseAgyCanaryQualityReview(result.text, runEvidence);
    } catch (error) {
      const postReviewStatus = await ctx.client.workflow.status();
      if (
        postReviewStatus.agentOperatingState?.runtimeId !==
          baseline.agentRuntimeId ||
        postReviewStatus.agentBackoff === undefined
      ) {
        throw error;
      }
      status = postReviewStatus;
      incidents = agyCanaryProviderIncidents(
        deadLetters.items,
        status,
        windowStartedAt,
      );
      pendingReviewRunIds = agentRuns.map((run) => run.id);
      carriedRunIds = [...new Set([
        ...carriedRunIds,
        ...pendingReviewRunIds,
      ])];
      packet.status = status;
      packet.carriedRunIds = carriedRunIds;
      packet.pendingReviewRuns = agentRuns;
      packet.providerIncidents = incidents;
      writeJsonFileAtomic(packetPath, packet);
      suppressReview = true;
    }
  }
  const runById = new Map(agentRuns.map((run) => [run.id, run]));
  const reviewDecisions = agentRuns.map((run) =>
    readReviewDecision(join(runsDir, run.id, "critic-review.json"))
  ).filter((decision) => decision !== null);
  const agentWorkflowNames = new Set(agentWorkflowDefinitions.keys());
  const successfulEmptyResults = incidents
    .filter((incident) => incident.kind === "output_contract")
    .reduce((total, incident) => total + incident.observations, 0);
  const observation: AgyCanaryObservation = {
    startedAt: windowStartedAt,
    observedAt,
    trigger: incidents.some((incident) => incident.active)
      ? "provider-incident"
      : review.runs.some((run) =>
          !run.instructionAdherent || !run.cleanupHealthy || run.rushedWork ||
          run.shallowVerification || run.unrelatedChangedPaths.length > 0 ||
          run.generatedDebrisPaths.length > 0
        )
      ? "quality-signal"
      : "window-elapsed",
    metrics: {
      agentRuns: agentRuns.length,
      activeAgentRuns: activeRunIds.length,
      pendingReviewRuns: pendingReviewRunIds.length,
      preservedAgentRuns:
        status.pendingRuns.filter((pending) =>
          agentWorkflowNames.has(pending.workflowName)
        ).length,
      dispatchableTasks: tasks.tasks.filter(
        (task) => task.state === "open" && task.waitingOnTasks.length === 0,
      ).length,
      usefulCompletions: review.runs.filter((run) => {
        const observed = runById.get(run.runId);
        return run.useful &&
          (observed?.status === "success" ||
            observed?.status === "completed-with-warnings");
      }).length,
      failedRuns: agentRuns.filter((run) => run.status === "failed").length,
      retriedRuns: agentRuns.filter(
        (run) =>
          run.retryOf !== undefined || run.resumedFromRunId !== undefined,
      ).length,
      providerBackoffMs: agyCanaryProviderBackoffDurationMs(
        incidents,
        windowStartedAt,
        observedAt,
      ),
      reviewRuns: reviewDecisions.length,
      usefulReviews:
        reviewDecisions.filter((decision) => decision === "useful").length,
      instructionChecks: review.runs.length,
      instructionFailures:
        review.runs.filter((run) => !run.instructionAdherent).length,
      unrelatedChangedPaths: review.runs.reduce(
        (total, run) => total + run.unrelatedChangedPaths.length,
        0,
      ),
      cleanupFailures: review.runs.filter((run) => !run.cleanupHealthy).length,
      successfulEmptyResults,
      rushedWorkFindings: review.runs.filter((run) => run.rushedWork).length,
      shallowVerificationFindings:
        review.runs.filter((run) => run.shallowVerification).length,
      generatedDebrisPaths: review.runs.reduce(
        (total, run) => total + run.generatedDebrisPaths.length,
        0,
      ),
    },
    sampledEvidence: [
      evidenceRef(ctx.cwd, packetPath),
      ...[...runEvidence.values()].flatMap((refs) => [...refs]),
    ],
    diffScopeEvidence,
    providerIncidents: incidents,
    ...(status.agentBackoff?.kind === "quality"
      ? {
        activeQualityIncident: {
          reason: status.agentBackoff.reason,
          updatedAt: status.agentBackoff.updatedAt,
        },
      }
      : {}),
    minorFindings: review.minorFindings,
  };
  const assessment = assessAgyCanary(phase, observation);
  const taskResults: Array<{
    fingerprint: string;
    result: Awaited<ReturnType<ModuleContext["client"]["tasks"]["create"]>>;
  }> = [];
  for (const finding of assessment.minorFindings) {
    taskResults.push({
      fingerprint: finding.fingerprint,
      result: await materializeAgyCanaryFindingTask(ctx, finding),
    });
  }
  let control: Record<string, unknown> = { action: "none" };
  if (assessment.decision.kind === "pause-quality") {
    const result = await ctx.client.workflow.pauseAgentForQuality(
      `AGY canary ${phase}: ${assessment.decision.reasons.join(", ")}`,
    );
    if (!result.ok) {
      throw new Error(
        "A live daemon is required to persist the AGY quality incident",
      );
    }
    control = { action: "workflow.agent.quality-pause", result };
  }
  const artifact = {
    schemaVersion: CANARY_SCHEMA_VERSION,
    artifactType: "agy-continuous-canary",
    runId,
    windowStartedAt,
    observedAt,
    trigger: observation.trigger,
    ...assessment,
    qualityReview: suppressReview
      ? {
        status: "suppressed",
        reason: status.agentBackoff === undefined
          ? carriedRunIds.length > 0
            ? "active-agent-runs-carried-forward"
            : "no-agent-runs-during-provider-window"
          : `active-${status.agentBackoff.kind}-incident`,
      }
      : { status: "completed", ...review },
    taskResults,
    control,
  };
  writeJsonFileAtomic(join(outputDir, "canary.json"), artifact);
  writeJsonFileAtomic(checkpointPath, {
    schemaVersion: CANARY_SCHEMA_VERSION,
    artifactType: "agy-continuous-canary-checkpoint",
    runId,
    nextWindowStartedAt: observedAt,
    completedWindows: checkpoint.completedWindows + 1,
    carriedRunIds,
    lastPhase: phase,
  } satisfies AgyCanaryCheckpoint);
  return artifact;
}

export function buildAgyCanaryCommand(ctx: ModuleContext): Command {
  return new Command("agy-canary")
    .description(
      "Start or assess an evidence-collected AGY autonomy canary window",
    )
    .requiredOption("--run-id <id>", "Canary run identity")
    .option("--start", "Capture the persisted canary baseline")
    .option("--phase <phase>", "Assess the three-hour or six-hour window")
    .action(async (options: AgyCanaryCommandOptions) => {
      const runId = validateWorkflowRunId(options.runId, "AGY canary run id");
      if (options.start === true && options.phase !== undefined) {
        throw new Error("Choose either --start or --phase");
      }
      if (
        options.start !== true && options.phase !== "three-hour" &&
        options.phase !== "six-hour"
      ) {
        throw new Error('Use --start or --phase "three-hour" | "six-hour"');
      }
      const artifact = options.start === true
        ? await startCanary(ctx, runId)
        : await observeCanary(ctx, runId, options.phase as AgyCanaryPhase);
      writeJson(artifact, { pretty: true });
    });
}
