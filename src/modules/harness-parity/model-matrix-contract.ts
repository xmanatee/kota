import type { AgentEffort } from "#core/agent-harness/index.js";

export type HarnessParityMatrixProvider =
  | "active-preset"
  | "anthropic"
  | "local"
  | "openai"
  | "openrouter"
  | "unknown";

export type HarnessParityMatrixModelRole = "baseline" | "candidate";
export type HarnessParityMatrixTargetKind =
  | "harness-parity-scenario"
  | "eval-harness-fixture";

export type HarnessParityMatrixModelInput = {
  model: string;
  label?: string;
  provider?: HarnessParityMatrixProvider;
};

export type HarnessParityMatrixOptions = {
  baselines?: HarnessParityMatrixModelInput[];
  candidates?: HarnessParityMatrixModelInput[];
  candidateSets?: string[];
  scenarios?: string[];
  evalFixtures?: string[];
  harnesses?: string[];
  repeats?: number;
  maxTurns?: number;
  effort?: AgentEffort;
  outDir?: string;
  keepWorkingDir?: boolean;
  hostClass?: string;
  cpuAllocationCores?: number;
  cpuKillThresholdCores?: number;
  memoryAllocationMB?: number;
  memoryKillThresholdMB?: number;
};

export type HarnessParityMatrixCapabilityMetadata =
  | {
      status: "available";
      source: "openrouter";
      observedAt: string;
      sourceUrl: string;
      contextLength: number;
      maxOutputTokens: number | null;
      supportsTools: boolean;
      supportsReasoning: boolean;
      mandatoryReasoning: boolean;
    }
  | {
      status: "unavailable";
      reason: string;
    };

export type HarnessParityMatrixVerificationSummary = {
  passed: boolean;
  exitStatus: number | null;
  timedOut: boolean;
  command: string;
};

export type HarnessParityMatrixResourceProfile = {
  cpuAllocationCores: number;
  cpuKillThresholdCores: number;
  memoryAllocationMB: number;
  memoryKillThresholdMB: number;
  hostClass: string;
};

export type HarnessParityMatrixExecutionProfileSummary = {
  status: "verified" | "non-gating" | "rejected";
  backendKind: string;
  verification: string;
  gateEligible: boolean;
  reason: string;
};

export type HarnessParityMatrixResolvedHarnessModelPair = {
  harness: string;
  model: string;
  count: number;
};

export type HarnessParityMatrixEvalHarnessEvidence = {
  outcome: string;
  executionMode: "live" | "replay" | null;
  runArtifactPath: string;
  runConfigurationFingerprint: string;
  runConfigurationSummary: {
    activePreset: string;
    fixtureManifest: string;
    sourceIdentity: string;
    resolvedHarnessModelEvidence: string;
    resourceProfile: string;
    executionProfile: string;
  };
  resourceProfile: HarnessParityMatrixResourceProfile;
  executionProfile: HarnessParityMatrixExecutionProfileSummary;
  resolvedHarnessModelEvidence: {
    status: "complete" | "empty" | "missing" | "mixed";
    distinctHarnessModels: HarnessParityMatrixResolvedHarnessModelPair[];
  };
};

export type HarnessParityMatrixRow = {
  rowId: string;
  targetKind: HarnessParityMatrixTargetKind;
  role: HarnessParityMatrixModelRole;
  label: string;
  provider: HarnessParityMatrixProvider;
  model: string;
  requestedModel: string;
  harnessName: string;
  scenarioId: string;
  repeatIndex: number;
  repeatCount: number;
  status: "passed" | "failed" | "error" | "skipped";
  skipReason?: string;
  capabilityMetadata: HarnessParityMatrixCapabilityMetadata;
  durationMs: number;
  turns: number;
  tokenUsage: {
    inputTokens: number | null;
    outputTokens: number | null;
  };
  estimatedCostUsd: number | null;
  toolCounts: {
    toolCalls: number;
    toolResults: number;
  };
  approvalCounts: {
    approvalRequests: number;
  };
  verification: HarnessParityMatrixVerificationSummary | null;
  trajectoryDiagnostics: {
    warningCount: number;
    missingStreamingFramesCount: number;
    unsupportedTrajectoryCount: number;
  } | null;
  changedFiles: string[];
  artifactDir?: string;
  evalHarness?: HarnessParityMatrixEvalHarnessEvidence;
};

export type HarnessParityMatrixGroupAggregate = {
  targetKind: HarnessParityMatrixTargetKind;
  role: HarnessParityMatrixModelRole;
  label: string;
  provider: HarnessParityMatrixProvider;
  model: string;
  harnessName: string;
  scenarioId: string;
  repeatCount: number;
  runnableRepeats: number;
  skippedRepeats: number;
  passedRepeats: number;
  passAtK: number | null;
  passHatK: number | null;
};

export type HarnessParityMatrixAggregate = {
  groupCount: number;
  runnableGroupCount: number;
  skippedGroupCount: number;
  passAtK: number | null;
  passHatK: number | null;
};

export type HarnessParityMatrixCompatibilityCheck = {
  name: string;
  passed: boolean;
  detail: string;
};

export type HarnessParityMatrixShadowComparison = {
  baseline: {
    targetKind: HarnessParityMatrixTargetKind;
    label: string;
    model: string;
    harnessName: string;
    scenarioId: string;
  };
  candidate: {
    targetKind: HarnessParityMatrixTargetKind;
    label: string;
    model: string;
    harnessName: string;
    scenarioId: string;
  };
  compatible: boolean;
  compatibilityReason: string;
  compatibilityChecks: HarnessParityMatrixCompatibilityCheck[];
  workspaceIsolation: "cloned-scenario-working-tree";
  passAtKDelta: number | null;
  passHatKDelta: number | null;
  latencyDeltaMs: number | null;
  costDeltaUsd: number | null;
  diff: {
    baselineChangedFiles: string[];
    candidateChangedFiles: string[];
    sharedChangedFiles: string[];
  };
  tests: {
    command: string | null;
    baselinePassed: boolean | null;
    candidatePassed: boolean | null;
  };
  failures: {
    baselineStatus: "passed" | "failed" | "error" | "skipped";
    candidateStatus: "passed" | "failed" | "error" | "skipped";
  };
  planEvidence: {
    baselineTraceSummaryPath: string | null;
    candidateTraceSummaryPath: string | null;
  };
};

export type HarnessParityMatrixResult =
  | {
      ok: true;
      outBaseDir: string;
      reportPath: string;
      rows: HarnessParityMatrixRow[];
      groups: HarnessParityMatrixGroupAggregate[];
      aggregate: HarnessParityMatrixAggregate;
      shadowComparisons: HarnessParityMatrixShadowComparison[];
    }
  | {
      ok: false;
      reason:
        | "scenarios_load_error"
        | "no_scenarios"
        | "no_harnesses"
        | "invalid_repeats"
        | "invalid_max_turns"
        | "invalid_resource_profile"
        | "invalid_candidate_set"
        | "invalid_model"
        | "fixtures_load_error"
        | "no_fixtures";
      message: string;
    };
