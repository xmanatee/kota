export const AGY_CANARY_PHASE_MINIMUM_MS = {
  "three-hour": 3 * 60 * 60 * 1000,
  "six-hour": 6 * 60 * 60 * 1000,
} as const;

const MATERIAL_PROVIDER_BACKOFF_RATIO = 0.5;
const MATERIAL_FAILED_OR_RETRIED_RUNS = 4;
const MATERIAL_FAILURE_TO_COMPLETION_RATIO = 3;

export type AgyCanaryPhase = keyof typeof AGY_CANARY_PHASE_MINIMUM_MS;
export type AgyCanaryTrigger =
  | "window-elapsed"
  | "provider-incident"
  | "quality-signal";

export type AgyCanaryProviderIncident = {
  fingerprint: string;
  kind: "rate_limit" | "auth" | "provider" | "runtime" | "output_contract";
  observations: number;
  active: boolean;
  firstObservedAt?: string;
  resetAt?: string;
};

export type AgyCanaryMinorFinding = {
  fingerprint: string;
  title: string;
  description: string;
  evidenceRef: string;
};

export type AgyCanaryRunReview = {
  runId: string;
  useful: boolean;
  instructionAdherent: boolean;
  cleanupHealthy: boolean;
  rushedWork: boolean;
  shallowVerification: boolean;
  unrelatedChangedPaths: string[];
  generatedDebrisPaths: string[];
  evidenceRefs: string[];
};

export type AgyCanaryQualityReview = {
  runs: AgyCanaryRunReview[];
  minorFindings: AgyCanaryMinorFinding[];
};

export type AgyCanaryObservation = {
  startedAt: string;
  observedAt: string;
  trigger: AgyCanaryTrigger;
  metrics: {
    agentRuns: number;
    activeAgentRuns: number;
    pendingReviewRuns: number;
    preservedAgentRuns: number;
    dispatchableTasks: number;
    usefulCompletions: number;
    failedRuns: number;
    retriedRuns: number;
    providerBackoffMs: number;
    reviewRuns: number;
    usefulReviews: number;
    instructionChecks: number;
    instructionFailures: number;
    unrelatedChangedPaths: number;
    cleanupFailures: number;
    successfulEmptyResults: number;
    rushedWorkFindings: number;
    shallowVerificationFindings: number;
    generatedDebrisPaths: number;
  };
  sampledEvidence: string[];
  diffScopeEvidence: string[];
  providerIncidents: AgyCanaryProviderIncident[];
  activeQualityIncident?: { reason: string; updatedAt: string };
  minorFindings: AgyCanaryMinorFinding[];
};

export type AgyCanaryDecision =
  | { kind: "continue"; reasons: string[] }
  | { kind: "park-provider"; reasons: string[]; resetAt?: string }
  | { kind: "pause-quality"; reasons: string[] };

export type AgyCanaryAssessment = {
  phase: AgyCanaryPhase;
  windowDurationMs: number;
  metrics: AgyCanaryObservation["metrics"] & {
    providerBackoffRatio: number;
    reviewYield: number | null;
    instructionAdherence: number | null;
  };
  decision: AgyCanaryDecision;
  sampledEvidence: string[];
  diffScopeEvidence: string[];
  providerIncidents: AgyCanaryProviderIncident[];
  minorFindings: AgyCanaryMinorFinding[];
};

const TERMINAL_CANARY_RUN_STATUSES = new Set([
  "success",
  "completed-with-warnings",
  "failed",
  "interrupted",
]);

export function baselineCarriedAgyRunIds<
  TRun extends { id: string; workflow: string; status: string },
>(runs: readonly TRun[], agentWorkflowNames: ReadonlySet<string>): string[] {
  return runs
    .filter((run) =>
      agentWorkflowNames.has(run.workflow) &&
      !TERMINAL_CANARY_RUN_STATUSES.has(run.status)
    )
    .map((run) => run.id);
}

export function partitionAgyCanaryRuns<
  TRun extends { status: string; completedAt?: string },
>(runs: readonly TRun[], observedAt: string): {
  settled: TRun[];
  carried: TRun[];
} {
  const boundary = Date.parse(observedAt);
  const carried = runs.filter((run) =>
    run.status === "running" || run.completedAt === undefined ||
    Date.parse(run.completedAt) > boundary
  );
  const carriedSet = new Set(carried);
  return {
    settled: runs.filter((run) => !carriedSet.has(run)),
    carried,
  };
}

export function partitionAgyCanaryReviewRuns<
  TRun extends { status: string; completedAt?: string },
>(runs: readonly TRun[], observedAt: string, reviewBlocked: boolean): {
  reviewed: TRun[];
  active: TRun[];
  pendingReview: TRun[];
  carried: TRun[];
} {
  const partitioned = partitionAgyCanaryRuns(runs, observedAt);
  const pendingReview = reviewBlocked ? partitioned.settled : [];
  return {
    reviewed: reviewBlocked ? [] : partitioned.settled,
    active: partitioned.carried,
    pendingReview,
    carried: [...partitioned.carried, ...pendingReview],
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requiredFingerprint(value: unknown, label: string): string {
  const fingerprint = requiredString(value, label);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(fingerprint)) {
    throw new Error(`${label} must be a stable lowercase fingerprint`);
  }
  return fingerprint;
}

function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean`);
  return value;
}

function requiredStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((entry, index) =>
    requiredString(entry, `${label}[${index}]`)
  );
}

function parseJsonObject(text: string): Record<string, unknown> {
  const stripped = text
    .replace(/^```(?:json)?\s*\n?/m, "")
    .replace(/\n?```\s*$/m, "")
    .trim();
  try {
    return asRecord(JSON.parse(stripped), "AGY canary quality review");
  } catch (error) {
    throw new Error(
      `AGY canary reviewer returned invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function parseAgyCanaryQualityReview(
  text: string,
  expectedRunEvidence: ReadonlyMap<string, ReadonlySet<string>>,
): AgyCanaryQualityReview {
  const input = parseJsonObject(text);
  if (!Array.isArray(input.runs)) {
    throw new Error("quality review runs must be an array");
  }
  const seen = new Set<string>();
  const runs = input.runs.map((raw, index): AgyCanaryRunReview => {
    const run = asRecord(raw, `runs[${index}]`);
    const runId = requiredString(run.runId, `runs[${index}].runId`);
    if (seen.has(runId)) {
      throw new Error(`quality review duplicates run "${runId}"`);
    }
    seen.add(runId);
    const allowed = expectedRunEvidence.get(runId);
    if (allowed === undefined) {
      throw new Error(`quality review references unknown run "${runId}"`);
    }
    const evidenceRefs = requiredStringArray(
      run.evidenceRefs,
      `runs[${index}].evidenceRefs`,
    );
    if (evidenceRefs.length === 0) {
      throw new Error(
        `quality review run "${runId}" must cite collected evidence`,
      );
    }
    for (const ref of evidenceRefs) {
      if (!allowed.has(ref)) {
        throw new Error(
          `quality review run "${runId}" cites uncollected evidence "${ref}"`,
        );
      }
    }
    const omittedEvidence = [...allowed].filter((ref) =>
      !evidenceRefs.includes(ref)
    );
    if (omittedEvidence.length > 0) {
      throw new Error(
        `quality review run "${runId}" omitted collected evidence: ${
          omittedEvidence.join(", ")
        }`,
      );
    }
    return {
      runId,
      useful: requiredBoolean(run.useful, `runs[${index}].useful`),
      instructionAdherent: requiredBoolean(
        run.instructionAdherent,
        `runs[${index}].instructionAdherent`,
      ),
      cleanupHealthy: requiredBoolean(
        run.cleanupHealthy,
        `runs[${index}].cleanupHealthy`,
      ),
      rushedWork: requiredBoolean(run.rushedWork, `runs[${index}].rushedWork`),
      shallowVerification: requiredBoolean(
        run.shallowVerification,
        `runs[${index}].shallowVerification`,
      ),
      unrelatedChangedPaths: requiredStringArray(
        run.unrelatedChangedPaths,
        `runs[${index}].unrelatedChangedPaths`,
      ),
      generatedDebrisPaths: requiredStringArray(
        run.generatedDebrisPaths,
        `runs[${index}].generatedDebrisPaths`,
      ),
      evidenceRefs,
    };
  });
  const missing = [...expectedRunEvidence.keys()].filter((runId) =>
    !seen.has(runId)
  );
  if (missing.length > 0) {
    throw new Error(
      `quality review omitted observed run(s): ${missing.join(", ")}`,
    );
  }
  if (!Array.isArray(input.minorFindings)) {
    throw new Error("quality review minorFindings must be an array");
  }
  const allowedEvidence = new Set(
    [...expectedRunEvidence.values()].flatMap((refs) => [...refs]),
  );
  const findings = input.minorFindings.map(
    (raw, index): AgyCanaryMinorFinding => {
      const finding = asRecord(raw, `minorFindings[${index}]`);
      const evidenceRef = requiredString(
        finding.evidenceRef,
        `minorFindings[${index}].evidenceRef`,
      );
      if (!allowedEvidence.has(evidenceRef)) {
        throw new Error(
          `minor finding cites uncollected evidence "${evidenceRef}"`,
        );
      }
      return {
        fingerprint: requiredFingerprint(
          finding.fingerprint,
          `minorFindings[${index}].fingerprint`,
        ),
        title: requiredString(finding.title, `minorFindings[${index}].title`),
        description: requiredString(
          finding.description,
          `minorFindings[${index}].description`,
        ),
        evidenceRef,
      };
    },
  );
  return {
    runs,
    minorFindings: [
      ...new Map(findings.map((finding) => [finding.fingerprint, finding]))
        .values(),
    ],
  };
}

export function assessAgyCanary(
  phase: AgyCanaryPhase,
  observation: AgyCanaryObservation,
): AgyCanaryAssessment {
  const windowDurationMs = Date.parse(observation.observedAt) -
    Date.parse(observation.startedAt);
  if (windowDurationMs < AGY_CANARY_PHASE_MINIMUM_MS[phase]) {
    throw new Error(
      `${phase} observation is early by ${
        AGY_CANARY_PHASE_MINIMUM_MS[phase] - windowDurationMs
      }ms`,
    );
  }
  if (
    (observation.metrics.agentRuns === 0 &&
      observation.metrics.activeAgentRuns === 0 &&
      observation.metrics.pendingReviewRuns === 0 &&
      observation.providerIncidents.length === 0) ||
    observation.sampledEvidence.length === 0
  ) {
    throw new Error(
      `${phase} observation contains neither AGY agent-run nor provider-incident evidence`,
    );
  }
  const activeIncident = observation.providerIncidents.find((incident) =>
    incident.active
  );
  const reviewSuppressed = activeIncident !== undefined ||
    observation.activeQualityIncident !== undefined;
  if (
    observation.metrics.instructionChecks !== observation.metrics.agentRuns &&
    !(reviewSuppressed && observation.metrics.instructionChecks === 0)
  ) {
    throw new Error(`${phase} observation did not review every AGY agent run`);
  }
  const metrics = observation.metrics;
  const providerBackoffRatio = Math.min(
    1,
    metrics.providerBackoffMs / windowDurationMs,
  );
  const hasRemainingWork = metrics.dispatchableTasks > 0 ||
    metrics.preservedAgentRuns > 0;
  const failedOrRetriedRuns = metrics.failedRuns + metrics.retriedRuns;
  const materialReasons: string[] = [];
  if (metrics.successfulEmptyResults >= 2) {
    materialReasons.push("repeated-successful-empty-results");
  }
  if (
    observation.providerIncidents.some(
      (incident) => incident.active && incident.kind === "output_contract",
    )
  ) {
    materialReasons.push("active-output-contract-incident");
  }
  if (observation.activeQualityIncident !== undefined) {
    materialReasons.push("active-quality-incident");
  }
  if (
    metrics.instructionChecks === metrics.agentRuns &&
    metrics.agentRuns >= 3 &&
    metrics.usefulCompletions === 0
  ) {
    materialReasons.push("zero-useful-completions");
  }
  if (
    hasRemainingWork &&
    metrics.usefulCompletions > 0 &&
    failedOrRetriedRuns >= MATERIAL_FAILED_OR_RETRIED_RUNS &&
    failedOrRetriedRuns >=
      metrics.usefulCompletions * MATERIAL_FAILURE_TO_COMPLETION_RATIO
  ) {
    materialReasons.push("material-failure-retry-pressure");
  }
  if (
    hasRemainingWork && providerBackoffRatio >= MATERIAL_PROVIDER_BACKOFF_RATIO
  ) {
    materialReasons.push("excessive-provider-backoff");
  }
  if (metrics.instructionFailures > 0) {
    materialReasons.push("instruction-adherence-regression");
  }
  if (metrics.unrelatedChangedPaths > 0) {
    materialReasons.push("unrelated-edits");
  }
  if (metrics.cleanupFailures > 0) {
    materialReasons.push("recovery-hygiene-regression");
  }
  if (metrics.rushedWorkFindings > 0) materialReasons.push("rushed-work");
  if (metrics.shallowVerificationFindings > 0) {
    materialReasons.push("shallow-verification");
  }
  if (metrics.generatedDebrisPaths > 0) {
    materialReasons.push("generated-debris");
  }
  if (metrics.reviewRuns >= 3 && metrics.usefulReviews === 0) {
    materialReasons.push("zero-review-yield");
  }
  const activeQuotaIncident = activeIncident?.kind === "output_contract"
    ? undefined
    : activeIncident;
  const decision: AgyCanaryDecision = materialReasons.length > 0
    ? { kind: "pause-quality", reasons: materialReasons }
    : activeQuotaIncident !== undefined
    ? {
      kind: "park-provider",
      reasons: [activeQuotaIncident.kind === "rate_limit"
        ? "active-provider-quota-incident"
        : "active-provider-incident"],
      ...(activeQuotaIncident.resetAt === undefined
        ? {}
        : { resetAt: activeQuotaIncident.resetAt }),
    }
    : { kind: "continue", reasons: ["no-material-regression"] };
  return {
    phase,
    windowDurationMs,
    metrics: {
      ...metrics,
      providerBackoffRatio,
      reviewYield: metrics.reviewRuns === 0
        ? null
        : metrics.usefulReviews / metrics.reviewRuns,
      instructionAdherence: metrics.instructionChecks === 0
        ? null
        : (metrics.instructionChecks - metrics.instructionFailures) /
          metrics.instructionChecks,
    },
    decision,
    sampledEvidence: observation.sampledEvidence,
    diffScopeEvidence: observation.diffScopeEvidence,
    providerIncidents: observation.providerIncidents,
    minorFindings: observation.minorFindings,
  };
}
