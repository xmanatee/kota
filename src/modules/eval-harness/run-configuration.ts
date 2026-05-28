import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "#core/config/config.js";
import {
  mergePresetTiers,
  PRESET_ENV_VAR,
  type PresetSource,
  resolvePreset,
} from "#core/model/preset.js";
import {
  isMultiRoundFixtureSpec,
  type LoadedFixture,
} from "./fixture.js";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import type { FixtureRunReport } from "./runner.js";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | JsonObject;
type JsonObject = { readonly [key: string]: JsonValue };

export type EvalRunConfigurationSummary = {
  activePreset: string;
  fixtureManifest: string;
  sourceIdentity: string;
  resolvedHarnessModelEvidence: string;
  resourceProfile: string;
  executionProfile: string;
};

export type EvalRunConfigurationActivePreset = {
  id: string;
  source: PresetSource;
  harness: string;
  defaultModel: string;
  defaultEffort: string;
  tiers: {
    fast: string;
    balanced: string;
    capable: string;
  };
};

export type EvalRunConfigurationFixtureEntry = {
  id: string;
  mode: "single-workflow" | "multi-round";
  role: string;
  workflowNames: readonly string[];
  specHash: string;
};

export type EvalRunConfigurationFixtureManifest = {
  fixtureCount: number;
  hash: string;
  fixtures: readonly EvalRunConfigurationFixtureEntry[];
};

export type EvalRunConfigurationSourceIdentity =
  | {
      status: "available";
      headSha: string;
      dirty: boolean;
      statusHash: string;
      sourceHash: string;
    }
  | {
      status: "unavailable";
      reason:
        | "not-a-git-worktree"
        | "head-unavailable"
        | "status-unavailable"
        | "diff-unavailable";
      message: string;
    };

export type ResolvedHarnessModelObservation = {
  fixtureId: string;
  runIndex: number;
  workflowRunId: string;
  workflowName: string;
  stepId: string;
  harness: string;
  model: string;
};

export type ResolvedHarnessModelMissingArtifact = {
  fixtureId: string;
  runIndex: number;
  workflowName: string | null;
  reason: "execution-artifact-missing" | "metadata-missing" | "metadata-invalid";
};

export type ResolvedHarnessModelPair = {
  harness: string;
  model: string;
  count: number;
};

export type ResolvedHarnessModelEvidence = {
  status: "complete" | "empty" | "missing" | "mixed";
  observations: readonly ResolvedHarnessModelObservation[];
  missingArtifacts: readonly ResolvedHarnessModelMissingArtifact[];
  distinctHarnessModels: readonly ResolvedHarnessModelPair[];
};

export type ResolvedHarnessModelEvidenceAccumulator = {
  observations: ResolvedHarnessModelObservation[];
  missingArtifacts: ResolvedHarnessModelMissingArtifact[];
};

export type EvalRunConfiguration = {
  fingerprint: string;
  summary: EvalRunConfigurationSummary;
  components: {
    activePreset: EvalRunConfigurationActivePreset;
    fixtureManifest: EvalRunConfigurationFixtureManifest;
    sourceIdentity: EvalRunConfigurationSourceIdentity;
    resolvedHarnessModelEvidence: ResolvedHarnessModelEvidence;
    resourceProfile: ResourceProfile;
    executionProfile: ExecutionProfilePreflightResult;
  };
};

export type EvalRunConfigurationOperatorSummary = {
  fingerprint: string;
  summary: EvalRunConfigurationSummary;
};

export type EvalRunConfigurationMismatchReason =
  | "prior-run-configuration-unavailable"
  | "active-preset-drift"
  | "fixture-manifest-drift"
  | "source-identity-unavailable"
  | "source-identity-drift"
  | "resolved-harness-model-evidence-unavailable"
  | "resolved-harness-model-drift"
  | "execution-profile-drift";

export type EvalRunConfigurationComparison =
  | { status: "comparable" }
  | {
      status: "mismatch";
      reason: EvalRunConfigurationMismatchReason;
      message: string;
      priorFingerprint: string;
      candidateFingerprint: string;
      priorSummary: EvalRunConfigurationSummary;
      candidateSummary: EvalRunConfigurationSummary;
    };

type GitCapture =
  | { ok: true; stdout: string }
  | { ok: false; message: string };

type WorkflowStepEvidenceFile = {
  id: string;
  type: string;
  status?: string;
  harness?: string;
  model?: string;
};

type WorkflowRunEvidenceFile = {
  id: string;
  workflow: string;
  steps: readonly Partial<WorkflowStepEvidenceFile>[];
};

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const objectValue = value as JsonObject;
  return `{${Object.keys(objectValue)
    .sort((a, b) => a.localeCompare(b))
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableStringify(objectValue[key] ?? null)}`,
    )
    .join(",")}}`;
}

function resourceProfileJson(profile: ResourceProfile): JsonObject {
  return {
    hostClass: profile.hostClass,
    cpuAllocationCores: profile.cpuAllocationCores,
    cpuKillThresholdCores: profile.cpuKillThresholdCores,
    memoryAllocationMB: profile.memoryAllocationMB,
    memoryKillThresholdMB: profile.memoryKillThresholdMB,
  };
}

function executionProfileJson(
  profile: ExecutionProfilePreflightResult,
): JsonObject {
  const base: JsonObject = {
    status: profile.status,
    backendKind: profile.backendKind,
    requestedProfile: resourceProfileJson(profile.requestedProfile),
    observedOrEnforcedProfile: resourceProfileJson(
      profile.observedOrEnforcedProfile,
    ),
    verification: profile.verification,
    gateEligible: profile.gateEligible,
  };
  if (profile.status === "verified") {
    return { ...base, eligibilityReason: profile.eligibilityReason };
  }
  if (profile.status === "rejected") {
    return { ...base, rejectionReason: profile.rejectionReason };
  }
  return { ...base, nonGatingReason: profile.nonGatingReason };
}

function executionProfileReason(
  profile: ExecutionProfilePreflightResult,
): string {
  if (profile.status === "verified") {
    return profile.eligibilityReason;
  }
  if (profile.status === "rejected") {
    return profile.rejectionReason;
  }
  return profile.nonGatingReason;
}

function executionProfileComparableJson(
  profile: ExecutionProfilePreflightResult,
): JsonObject {
  return {
    status: profile.status,
    backendKind: profile.backendKind,
    verification: profile.verification,
    gateEligible: profile.gateEligible,
    reason: executionProfileReason(profile),
  };
}

function runGit(projectDir: string, args: readonly string[]): GitCapture {
  const result = spawnSync("git", [...args], {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0 && result.error === undefined) {
    return { ok: true, stdout: result.stdout.trimEnd() };
  }
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
  return {
    ok: false,
    message: result.error?.message ?? stderr,
  };
}

function sourceIdentityJson(
  identity: EvalRunConfigurationSourceIdentity,
): JsonObject {
  if (identity.status === "available") {
    return {
      status: identity.status,
      headSha: identity.headSha,
      dirty: identity.dirty,
      statusHash: identity.statusHash,
      sourceHash: identity.sourceHash,
    };
  }
  return { status: identity.status, reason: identity.reason };
}

function readSourceIdentity(
  projectDir: string,
): EvalRunConfigurationSourceIdentity {
  const inside = runGit(projectDir, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout !== "true") {
    return {
      status: "unavailable",
      reason: "not-a-git-worktree",
      message: inside.ok ? "git did not report a worktree" : inside.message,
    };
  }
  const head = runGit(projectDir, ["rev-parse", "HEAD"]);
  if (!head.ok || head.stdout.length === 0) {
    return {
      status: "unavailable",
      reason: "head-unavailable",
      message: head.ok ? "git returned an empty HEAD" : head.message,
    };
  }
  const status = runGit(projectDir, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (!status.ok) {
    return {
      status: "unavailable",
      reason: "status-unavailable",
      message: status.message,
    };
  }
  const worktreeDiff = runGit(projectDir, ["diff", "--binary", "--no-ext-diff"]);
  const stagedDiff = runGit(projectDir, [
    "diff",
    "--cached",
    "--binary",
    "--no-ext-diff",
  ]);
  if (!worktreeDiff.ok || !stagedDiff.ok) {
    const message = !worktreeDiff.ok
      ? worktreeDiff.message
      : !stagedDiff.ok
        ? stagedDiff.message
        : "";
    return {
      status: "unavailable",
      reason: "diff-unavailable",
      message,
    };
  }
  return {
    status: "available",
    headSha: head.stdout,
    dirty: status.stdout.length > 0,
    statusHash: sha256(status.stdout),
    sourceHash: sha256(
      stableStringify({
        headSha: head.stdout,
        status: status.stdout,
        worktreeDiff: worktreeDiff.stdout,
        stagedDiff: stagedDiff.stdout,
      }),
    ),
  };
}

function fixtureWorkflowNames(fixture: LoadedFixture): readonly string[] {
  if (isMultiRoundFixtureSpec(fixture.spec)) {
    return fixture.spec.rounds.map((round) => round.workflowName);
  }
  return [fixture.spec.workflowName];
}

function buildFixtureManifest(
  fixtures: readonly LoadedFixture[],
): EvalRunConfigurationFixtureManifest {
  const entries = fixtures
    .map((fixture) => {
      const specJson = JSON.parse(JSON.stringify(fixture.spec)) as JsonValue;
      return {
        id: fixture.spec.id,
        mode: fixture.spec.mode,
        role: fixture.spec.role,
        workflowNames: fixtureWorkflowNames(fixture),
        specHash: sha256(stableStringify(specJson)),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const manifestWithoutHash: JsonObject = {
    fixtureCount: entries.length,
    fixtures: entries.map((entry) => ({
      id: entry.id,
      mode: entry.mode,
      role: entry.role,
      workflowNames: entry.workflowNames,
      specHash: entry.specHash,
    })),
  };
  return {
    fixtureCount: entries.length,
    hash: sha256(stableStringify(manifestWithoutHash)),
    fixtures: entries,
  };
}

export function createResolvedHarnessModelEvidenceAccumulator(): ResolvedHarnessModelEvidenceAccumulator {
  return { observations: [], missingArtifacts: [] };
}

function recordMissingArtifact(
  accumulator: ResolvedHarnessModelEvidenceAccumulator,
  fixtureId: string,
  runIndex: number,
  workflowName: string | null,
  reason: ResolvedHarnessModelMissingArtifact["reason"],
): void {
  accumulator.missingArtifacts.push({
    fixtureId,
    runIndex,
    workflowName,
    reason,
  });
}

function recordWorkflowRunEvidence(params: {
  accumulator: ResolvedHarnessModelEvidenceAccumulator;
  fixtureId: string;
  runIndex: number;
  workflowName: string | null;
  workflowRunArtifactPath: string | null;
}): void {
  if (params.workflowRunArtifactPath === null) {
    recordMissingArtifact(
      params.accumulator,
      params.fixtureId,
      params.runIndex,
      params.workflowName,
      "execution-artifact-missing",
    );
    return;
  }
  const metadataPath = join(params.workflowRunArtifactPath, "metadata.json");
  if (!existsSync(metadataPath)) {
    recordMissingArtifact(
      params.accumulator,
      params.fixtureId,
      params.runIndex,
      params.workflowName,
      "metadata-missing",
    );
    return;
  }

  let metadata: Partial<WorkflowRunEvidenceFile>;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as Partial<WorkflowRunEvidenceFile>;
  } catch {
    recordMissingArtifact(
      params.accumulator,
      params.fixtureId,
      params.runIndex,
      params.workflowName,
      "metadata-invalid",
    );
    return;
  }

  if (
    typeof metadata.id !== "string" ||
    typeof metadata.workflow !== "string" ||
    !Array.isArray(metadata.steps)
  ) {
    recordMissingArtifact(
      params.accumulator,
      params.fixtureId,
      params.runIndex,
      params.workflowName,
      "metadata-invalid",
    );
    return;
  }

  for (const step of metadata.steps) {
    if (step.type !== "agent") continue;
    if (step.status === "skipped") continue;
    if (
      typeof step.id !== "string" ||
      typeof step.harness !== "string" ||
      typeof step.model !== "string"
    ) {
      recordMissingArtifact(
        params.accumulator,
        params.fixtureId,
        params.runIndex,
        metadata.workflow,
        "metadata-invalid",
      );
      continue;
    }
    params.accumulator.observations.push({
      fixtureId: params.fixtureId,
      runIndex: params.runIndex,
      workflowRunId: metadata.id,
      workflowName: metadata.workflow,
      stepId: step.id,
      harness: step.harness,
      model: step.model,
    });
  }
}

export function addFixtureRunHarnessModelEvidence(
  accumulator: ResolvedHarnessModelEvidenceAccumulator,
  fixture: LoadedFixture,
  report: FixtureRunReport,
): void {
  if (isMultiRoundFixtureSpec(fixture.spec)) {
    for (const round of report.run.rounds ?? []) {
      recordWorkflowRunEvidence({
        accumulator,
        fixtureId: report.run.fixtureId,
        runIndex: report.run.runIndex,
        workflowName: round.workflowName,
        workflowRunArtifactPath: round.runArtifactPath,
      });
    }
    return;
  }
  recordWorkflowRunEvidence({
    accumulator,
    fixtureId: report.run.fixtureId,
    runIndex: report.run.runIndex,
    workflowName: fixture.spec.workflowName,
    workflowRunArtifactPath: report.executionOutcome.runArtifactPath,
  });
}

function summarizeDistinctHarnessModels(
  observations: readonly ResolvedHarnessModelObservation[],
): readonly ResolvedHarnessModelPair[] {
  const counts = new Map<string, ResolvedHarnessModelPair>();
  for (const observation of observations) {
    const key = `${observation.harness}\0${observation.model}`;
    const existing = counts.get(key);
    if (existing) {
      counts.set(key, { ...existing, count: existing.count + 1 });
    } else {
      counts.set(key, {
        harness: observation.harness,
        model: observation.model,
        count: 1,
      });
    }
  }
  return [...counts.values()].sort((a, b) =>
    a.harness === b.harness
      ? a.model.localeCompare(b.model)
      : a.harness.localeCompare(b.harness),
  );
}

export function finalizeResolvedHarnessModelEvidence(
  accumulator: ResolvedHarnessModelEvidenceAccumulator,
): ResolvedHarnessModelEvidence {
  const observations = [...accumulator.observations].sort((a, b) =>
    a.fixtureId === b.fixtureId
      ? a.runIndex - b.runIndex || a.stepId.localeCompare(b.stepId)
      : a.fixtureId.localeCompare(b.fixtureId),
  );
  const missingArtifacts = [...accumulator.missingArtifacts].sort((a, b) =>
    a.fixtureId === b.fixtureId
      ? a.runIndex - b.runIndex ||
        (a.workflowName ?? "").localeCompare(b.workflowName ?? "")
      : a.fixtureId.localeCompare(b.fixtureId),
  );
  const distinctHarnessModels = summarizeDistinctHarnessModels(observations);
  const status =
    missingArtifacts.length > 0
      ? "missing"
      : distinctHarnessModels.length > 1
        ? "mixed"
        : observations.length === 0
          ? "empty"
          : "complete";
  return {
    status,
    observations,
    missingArtifacts,
    distinctHarnessModels,
  };
}

function resolvedHarnessModelEvidenceFingerprintJson(
  evidence: ResolvedHarnessModelEvidence,
): JsonObject {
  return {
    status: evidence.status,
    missingArtifacts: evidence.missingArtifacts.map((missing) => ({
      fixtureId: missing.fixtureId,
      runIndex: missing.runIndex,
      workflowName: missing.workflowName,
      reason: missing.reason,
    })),
    distinctHarnessModels: evidence.distinctHarnessModels.map((pair) => ({
      harness: pair.harness,
      model: pair.model,
      count: pair.count,
    })),
  };
}

function activePresetJson(
  preset: EvalRunConfigurationActivePreset,
): JsonObject {
  return {
    id: preset.id,
    harness: preset.harness,
    defaultModel: preset.defaultModel,
    defaultEffort: preset.defaultEffort,
    tiers: {
      fast: preset.tiers.fast,
      balanced: preset.tiers.balanced,
      capable: preset.tiers.capable,
    },
  };
}

function sourceIdentitySummary(
  identity: EvalRunConfigurationSourceIdentity,
): string {
  if (identity.status === "available") {
    const state = identity.dirty ? "dirty" : "clean";
    return `${identity.headSha.slice(0, 12)} (${state}, ${identity.sourceHash.slice(0, 12)})`;
  }
  return `unavailable:${identity.reason}`;
}

function resolvedHarnessModelSummary(
  evidence: ResolvedHarnessModelEvidence,
): string {
  if (evidence.status === "empty") {
    return "no agent-step evidence";
  }
  const pairs = evidence.distinctHarnessModels
    .map((pair) => `${pair.harness}/${pair.model} x${pair.count}`)
    .join(", ");
  if (evidence.status === "missing") {
    return `missing ${evidence.missingArtifacts.length} artifact(s); ${pairs || "no observed pairs"}`;
  }
  if (evidence.status === "mixed") {
    return `mixed ${pairs}`;
  }
  return pairs;
}

function resourceProfileSummary(profile: ResourceProfile): string {
  return `${profile.hostClass} cpu=${profile.cpuAllocationCores}/${profile.cpuKillThresholdCores} memoryMB=${profile.memoryAllocationMB}/${profile.memoryKillThresholdMB}`;
}

function executionProfileSummary(
  profile: ExecutionProfilePreflightResult,
): string {
  return `${profile.status}/${profile.backendKind}/${profile.verification}/${executionProfileReason(profile)}`;
}

export function toRunConfigurationOperatorSummary(
  runConfiguration: EvalRunConfiguration,
): EvalRunConfigurationOperatorSummary {
  return {
    fingerprint: runConfiguration.fingerprint,
    summary: runConfiguration.summary,
  };
}

export function buildEvalRunConfiguration(params: {
  projectDir: string;
  fixtures: readonly LoadedFixture[];
  resourceProfile: ResourceProfile;
  executionProfile: ExecutionProfilePreflightResult;
  resolvedHarnessModelEvidence: ResolvedHarnessModelEvidence;
  env?: NodeJS.ProcessEnv;
}): EvalRunConfiguration {
  const config = loadConfig(params.projectDir);
  const env = params.env ?? process.env;
  const presetResolution = resolvePreset({
    env: env[PRESET_ENV_VAR],
    config: config.defaultPreset,
  });
  const tiers = mergePresetTiers(presetResolution.preset, config.modelTiers);
  const activePreset: EvalRunConfigurationActivePreset = {
    id: presetResolution.preset.id,
    source: presetResolution.source,
    harness: presetResolution.preset.harness,
    defaultModel: presetResolution.preset.defaultModel,
    defaultEffort: presetResolution.preset.defaultEffort,
    tiers,
  };
  const fixtureManifest = buildFixtureManifest(params.fixtures);
  const sourceIdentity = readSourceIdentity(params.projectDir);
  const fingerprintMaterial: JsonObject = {
    activePreset: activePresetJson(activePreset),
    fixtureManifest: { hash: fixtureManifest.hash },
    sourceIdentity: sourceIdentityJson(sourceIdentity),
    resolvedHarnessModelEvidence: resolvedHarnessModelEvidenceFingerprintJson(
      params.resolvedHarnessModelEvidence,
    ),
    resourceProfile: resourceProfileJson(params.resourceProfile),
    executionProfile: executionProfileJson(params.executionProfile),
  };
  const fingerprint = sha256(stableStringify(fingerprintMaterial));
  return {
    fingerprint,
    summary: {
      activePreset: `${activePreset.id} (${activePreset.source}) via ${activePreset.harness}`,
      fixtureManifest: `${fixtureManifest.fixtureCount} fixture(s) ${fixtureManifest.hash.slice(0, 12)}`,
      sourceIdentity: sourceIdentitySummary(sourceIdentity),
      resolvedHarnessModelEvidence: resolvedHarnessModelSummary(
        params.resolvedHarnessModelEvidence,
      ),
      resourceProfile: resourceProfileSummary(params.resourceProfile),
      executionProfile: executionProfileSummary(params.executionProfile),
    },
    components: {
      activePreset,
      fixtureManifest,
      sourceIdentity,
      resolvedHarnessModelEvidence: params.resolvedHarnessModelEvidence,
      resourceProfile: params.resourceProfile,
      executionProfile: params.executionProfile,
    },
  };
}

function activePresetsComparable(
  prior: EvalRunConfigurationActivePreset,
  candidate: EvalRunConfigurationActivePreset,
): boolean {
  return stableStringify(activePresetJson(prior)) === stableStringify(activePresetJson(candidate));
}

function sourceIdentitiesComparable(
  prior: EvalRunConfigurationSourceIdentity,
  candidate: EvalRunConfigurationSourceIdentity,
): boolean {
  if (prior.status !== "available" || candidate.status !== "available") {
    return false;
  }
  return (
    prior.headSha === candidate.headSha &&
    prior.dirty === candidate.dirty &&
    prior.sourceHash === candidate.sourceHash
  );
}

function harnessModelEvidenceComparable(
  prior: ResolvedHarnessModelEvidence,
  candidate: ResolvedHarnessModelEvidence,
): boolean {
  return (
    stableStringify(resolvedHarnessModelEvidenceFingerprintJson(prior)) ===
    stableStringify(resolvedHarnessModelEvidenceFingerprintJson(candidate))
  );
}

function executionProfilesComparable(
  prior: ExecutionProfilePreflightResult,
  candidate: ExecutionProfilePreflightResult,
): boolean {
  return (
    stableStringify(executionProfileComparableJson(prior)) ===
    stableStringify(executionProfileComparableJson(candidate))
  );
}

function mismatch(
  prior: EvalRunConfiguration,
  candidate: EvalRunConfiguration,
  reason: EvalRunConfigurationMismatchReason,
  message: string,
): EvalRunConfigurationComparison {
  return {
    status: "mismatch",
    reason,
    message,
    priorFingerprint: prior.fingerprint,
    candidateFingerprint: candidate.fingerprint,
    priorSummary: prior.summary,
    candidateSummary: candidate.summary,
  };
}

function unavailableSummary(): EvalRunConfigurationSummary {
  return {
    activePreset: "unavailable",
    fixtureManifest: "unavailable",
    sourceIdentity: "unavailable",
    resolvedHarnessModelEvidence: "unavailable",
    resourceProfile: "unavailable",
    executionProfile: "unavailable",
  };
}

export function missingPriorRunConfigurationComparison(
  candidate: EvalRunConfiguration,
): Extract<EvalRunConfigurationComparison, { status: "mismatch" }> {
  return {
    status: "mismatch",
    reason: "prior-run-configuration-unavailable",
    message:
      "prior baseline does not include a run-configuration fingerprint",
    priorFingerprint: "unavailable",
    candidateFingerprint: candidate.fingerprint,
    priorSummary: unavailableSummary(),
    candidateSummary: candidate.summary,
  };
}

export function compareRunConfigurations(
  prior: EvalRunConfiguration,
  candidate: EvalRunConfiguration,
): EvalRunConfigurationComparison {
  if (!activePresetsComparable(prior.components.activePreset, candidate.components.activePreset)) {
    return mismatch(
      prior,
      candidate,
      "active-preset-drift",
      "active preset, harness, default model, or tier mapping changed",
    );
  }
  if (
    prior.components.fixtureManifest.hash !==
    candidate.components.fixtureManifest.hash
  ) {
    return mismatch(
      prior,
      candidate,
      "fixture-manifest-drift",
      "fixture ids or loaded fixture specs changed",
    );
  }
  if (
    prior.components.sourceIdentity.status !== "available" ||
    candidate.components.sourceIdentity.status !== "available"
  ) {
    return mismatch(
      prior,
      candidate,
      "source-identity-unavailable",
      "source identity was unavailable for the prior or candidate run",
    );
  }
  if (
    !sourceIdentitiesComparable(
      prior.components.sourceIdentity,
      candidate.components.sourceIdentity,
    )
  ) {
    return mismatch(
      prior,
      candidate,
      "source-identity-drift",
      "KOTA source identity changed",
    );
  }
  if (
    prior.components.resolvedHarnessModelEvidence.status === "missing" ||
    prior.components.resolvedHarnessModelEvidence.status === "mixed" ||
    candidate.components.resolvedHarnessModelEvidence.status === "missing" ||
    candidate.components.resolvedHarnessModelEvidence.status === "mixed"
  ) {
    return mismatch(
      prior,
      candidate,
      "resolved-harness-model-evidence-unavailable",
      "resolved harness/model evidence is missing or mixed",
    );
  }
  if (
    !harnessModelEvidenceComparable(
      prior.components.resolvedHarnessModelEvidence,
      candidate.components.resolvedHarnessModelEvidence,
    )
  ) {
    return mismatch(
      prior,
      candidate,
      "resolved-harness-model-drift",
      "resolved harness/model observations changed",
    );
  }
  if (
    !executionProfilesComparable(
      prior.components.executionProfile,
      candidate.components.executionProfile,
    )
  ) {
    return mismatch(
      prior,
      candidate,
      "execution-profile-drift",
      "execution profile backend, verification, gate eligibility, or reason changed",
    );
  }
  return { status: "comparable" };
}
