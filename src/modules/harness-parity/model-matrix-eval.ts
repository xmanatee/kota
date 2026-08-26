import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { resolveActivePresetFromConfig } from "#core/model/preset.js";
import {
  createSubprocessExecutor,
  detectHostSubprocessResourceProfile,
  type EvalSetReport,
  type ExecutionProfilePreflightResult,
  executionProfileGateReason,
  type FixtureRun,
  type LoadedFixture,
  loadFixture,
  type ResourceProfile,
  runEvalSet,
  type WorkflowExecutor,
} from "#modules/eval-harness/public-surface.js";
import type {
  HarnessParityMatrixEvalHarnessEvidence,
  HarnessParityMatrixExecutionProfileSummary,
  HarnessParityMatrixOptions,
  HarnessParityMatrixResult,
  HarnessParityMatrixRow,
} from "./client.js";
import type { HarnessParityDeps } from "./harness-parity-operations.js";
import type {
  MatrixModelSpec,
  MatrixOpenRouterPreflight,
} from "./model-matrix-models.js";
import { skipReasonFor } from "./model-matrix-models.js";
import { skippedRow } from "./model-matrix-rows.js";

const DEFAULT_EVAL_HOST_CLASS = "local-dev";

function positiveNumber(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value > 0);
}

export function resolveEvalResourceProfile(
  options: HarnessParityMatrixOptions,
): ResourceProfile | HarnessParityMatrixResult {
  if (
    !positiveNumber(options.cpuAllocationCores) ||
    !positiveNumber(options.cpuKillThresholdCores) ||
    !positiveNumber(options.memoryAllocationMB) ||
    !positiveNumber(options.memoryKillThresholdMB)
  ) {
    return {
      ok: false,
      reason: "invalid_resource_profile",
      message:
        "Eval-harness resource profile values must be positive numbers when provided.",
    };
  }

  const hostClass = options.hostClass ?? DEFAULT_EVAL_HOST_CLASS;
  const detected = detectHostSubprocessResourceProfile(hostClass);
  const cpuAllocationCores =
    options.cpuAllocationCores ?? detected.cpuAllocationCores;
  const cpuKillThresholdCores =
    options.cpuKillThresholdCores ?? cpuAllocationCores;
  const memoryAllocationMB =
    options.memoryAllocationMB ?? detected.memoryAllocationMB;
  const memoryKillThresholdMB =
    options.memoryKillThresholdMB ?? memoryAllocationMB;

  return {
    hostClass,
    cpuAllocationCores,
    cpuKillThresholdCores,
    memoryAllocationMB,
    memoryKillThresholdMB,
  };
}

export function loadRequestedEvalFixtures(
  deps: HarnessParityDeps,
  ids: readonly string[] | undefined,
):
  | { ok: true; fixtures: LoadedFixture[] }
  | { ok: false; result: HarnessParityMatrixResult } {
  if (ids === undefined || ids.length === 0) {
    return { ok: true, fixtures: [] };
  }
  try {
    return {
      ok: true,
      fixtures: ids.map((id) => loadFixture(deps.evalFixturesRoot, id)),
    };
  } catch (err) {
    return {
      ok: false,
      result: {
        ok: false,
        reason: "fixtures_load_error",
        message: (err as Error).message,
      },
    };
  }
}

function executionProfileSummary(
  profile: ExecutionProfilePreflightResult,
): HarnessParityMatrixExecutionProfileSummary {
  return {
    status: profile.status,
    backendKind: profile.backendKind,
    verification: profile.verification,
    gateEligible: profile.gateEligible,
    reason: executionProfileGateReason(profile),
  };
}

function evalEvidence(
  report: EvalSetReport,
  run: FixtureRun,
): HarnessParityMatrixEvalHarnessEvidence {
  return {
    outcome: run.outcome,
    executionMode: run.executionMode ?? null,
    runArtifactPath: run.runArtifactPath,
    runConfigurationFingerprint: report.runConfiguration.fingerprint,
    runConfigurationSummary: report.runConfiguration.summary,
    resourceProfile: run.resourceProfile,
    executionProfile: executionProfileSummary(run.executionProfile),
    resolvedHarnessModelEvidence: {
      status:
        report.runConfiguration.components.resolvedHarnessModelEvidence.status,
      distinctHarnessModels: [
        ...report.runConfiguration.components.resolvedHarnessModelEvidence
          .distinctHarnessModels,
      ],
    },
  };
}

function expectedHarnessNameForSpec(
  deps: HarnessParityDeps,
  spec: MatrixModelSpec,
): string {
  if (spec.provider === "active-preset") {
    return resolveActivePresetFromConfig(deps.config).harness;
  }
  if (
    spec.provider === "openrouter" ||
    spec.provider === "openai" ||
    spec.provider === "local" ||
    spec.provider === "unknown"
  ) {
    return "openai-tools";
  }
  if (spec.provider === "anthropic") return "claude-agent-sdk";
  return "unknown";
}

function statusFromEvalOutcome(
  outcome: FixtureRun["outcome"],
): HarnessParityMatrixRow["status"] {
  if (outcome === "pass") return "passed";
  if (outcome === "fail") return "failed";
  return "error";
}

function rowFromEvalRun(args: {
  deps: HarnessParityDeps;
  spec: MatrixModelSpec;
  report: EvalSetReport;
  run: FixtureRun;
  rowId: string;
}): HarnessParityMatrixRow {
  const harnessName = expectedHarnessNameForSpec(args.deps, args.spec);
  return {
    rowId: args.rowId,
    targetKind: "eval-harness-fixture",
    role: args.spec.role,
    label: args.spec.label,
    provider: args.spec.provider,
    model: args.spec.model,
    requestedModel: args.spec.requestedModel,
    harnessName,
    scenarioId: args.run.fixtureId,
    repeatIndex: args.run.runIndex,
    repeatCount: args.run.repeatCount,
    status: statusFromEvalOutcome(args.run.outcome),
    capabilityMetadata: args.spec.capabilityMetadata,
    durationMs: args.run.timing.durationMs,
    turns: 0,
    tokenUsage: {
      inputTokens: null,
      outputTokens: null,
    },
    estimatedCostUsd: null,
    toolCounts: {
      toolCalls: 0,
      toolResults: 0,
    },
    approvalCounts: {
      approvalRequests: 0,
    },
    verification: null,
    trajectoryDiagnostics: null,
    changedFiles: [],
    evalHarness: evalEvidence(args.report, args.run),
  };
}

function rowIdForEvalRun(spec: MatrixModelSpec, run: FixtureRun): string {
  return [
    "eval",
    spec.role,
    spec.label,
    run.fixtureId,
    `r${run.runIndex + 1}`,
  ]
    .map((part) =>
      part
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80),
    )
    .join("-");
}

function defaultEvalExecutor(deps: HarnessParityDeps): WorkflowExecutor {
  return createSubprocessExecutor({
    kotaBinaryPath: deps.kotaBinaryPath,
    isolationBackend: { kind: "host-subprocess" },
  });
}

export async function runEvalFixturesForSpec(args: {
  deps: HarnessParityDeps;
  options: HarnessParityMatrixOptions;
  spec: MatrixModelSpec;
  openRouterPreflight: MatrixOpenRouterPreflight;
  fixtures: readonly LoadedFixture[];
  outBaseDir: string;
  repeats: number;
  requestedProfile: ResourceProfile;
}): Promise<HarnessParityMatrixRow[]> {
  const skipReason = skipReasonFor(args.spec, args.openRouterPreflight);
  if (skipReason !== null) {
    return args.fixtures.flatMap((fixture) =>
      Array.from({ length: args.repeats }, (_entry, repeatIndex) =>
        skippedRow({
          spec: args.spec,
          targetKind: "eval-harness-fixture",
          harnessName: expectedHarnessNameForSpec(args.deps, args.spec),
          scenarioId: fixture.spec.id,
          repeatIndex,
          repeatCount: args.repeats,
          rowId: [
            "eval",
            args.spec.role,
            args.spec.label,
            fixture.spec.id,
            `r${repeatIndex + 1}`,
          ].join("-"),
          skipReason,
        }),
      ),
    );
  }

  const runArtifactBaseDir = join(
    args.outBaseDir,
    "eval-fixtures",
    args.spec.role,
    args.spec.label.replace(/[^A-Za-z0-9._-]+/g, "-"),
  );
  const harnessName = expectedHarnessNameForSpec(args.deps, args.spec);
  mkdirSync(runArtifactBaseDir, { recursive: true });
  const report = await runEvalSet({
    workspaceRoot: args.deps.scopeRoot,
    fixtures: args.fixtures,
    executor: args.deps.evalExecutor ?? defaultEvalExecutor(args.deps),
    requestedProfile: args.requestedProfile,
    agentExecutionOverride: {
      harness: harnessName,
      model: args.spec.model,
    },
    runArtifactBaseDir: resolve(runArtifactBaseDir),
    repeatCount: args.repeats,
    keepWorkingDirs: args.options.keepWorkingDir ?? false,
  });

  return report.runs.map((run) =>
    rowFromEvalRun({
      deps: args.deps,
      spec: args.spec,
      report,
      run,
      rowId: rowIdForEvalRun(args.spec, run),
    }),
  );
}
