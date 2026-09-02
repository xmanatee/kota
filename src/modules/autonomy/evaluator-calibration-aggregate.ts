import { existsSync } from "node:fs";
import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  enumerateWorkflowRunMetadataFailClosed,
  enumerateWorkflowRunMetadataWithDurableAuthority,
} from "#core/workflow/run-operational-projection.js";
import { readWriterIntegrationEvidence } from "#core/workflow/writer-integration-evidence.js";
import { isCalibrationSourceFile } from "./evaluator-calibration-artifact.js";
import {
  evaluatorCalibrationDispositionKey,
  loadEvaluatorCalibrationDispositions,
} from "./evaluator-calibration-dispositions.js";
import {
  type CalibrationDriftKind,
  type CalibrationGateConfig,
  type CalibrationGateDecision,
  EVALUATOR_CALIBRATION_ARTIFACT,
  type EvaluatorCalibrationAggregate,
  type EvaluatorCalibrationArtifact,
  type EvaluatorCalibrationContradiction,
  type EvaluatorCalibrationVerdict,
} from "./evaluator-calibration-types.js";

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_FOLLOW_UP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export type AggregateCalibrationOptions = {
  authority?: { stateDir: string; scopeRoot: string };
  windowMs?: number;
  followUpWindowMs?: number;
  nowMs?: number;
  /** Only artifacts from the active critic prompt belong in the sample. */
  criticPromptHash: string;
};

type LoadedArtifact = {
  completedAtMs: number;
  artifact: EvaluatorCalibrationArtifact;
};

function loadCalibrationArtifactsInWindow(
  runsDir: string,
  windowMs: number,
  nowMs: number,
  criticPromptHash: string,
  authority?: { stateDir: string; scopeRoot: string },
): LoadedArtifact[] {
  if (!existsSync(runsDir)) return [];
  const cutoffMs = nowMs - windowMs;
  const loaded: LoadedArtifact[] = [];
  const enumeration = authority === undefined
    ? enumerateWorkflowRunMetadataFailClosed({ runsDir })
    : enumerateWorkflowRunMetadataWithDurableAuthority({
      runsDir,
      stateDir: authority.stateDir,
      scopeRoot: authority.scopeRoot,
    });
  for (const entry of enumeration.runs
    .map((run) => run.id)
    .sort()) {
    const raw = readOptionalJsonFile<EvaluatorCalibrationArtifact>(
      join(runsDir, entry, EVALUATOR_CALIBRATION_ARTIFACT),
    );
    if (!raw || raw.criticPromptHash !== criticPromptHash) continue;
    const integration = readWriterIntegrationEvidence(runsDir, entry);
    const artifact: EvaluatorCalibrationArtifact = integration
      ? {
          ...raw,
          completedAt: integration.completedAt,
          sourceRevision: integration.publishedHead,
          sourceFilesChanged: integration.changedPaths.filter(
            isCalibrationSourceFile,
          ),
        }
      : raw;
    const completedAtMs = Date.parse(artifact.completedAt);
    if (!Number.isFinite(completedAtMs)) continue;
    if (completedAtMs < cutoffMs || completedAtMs > nowMs) continue;
    loaded.push({ completedAtMs, artifact });
  }
  loaded.sort((a, b) => a.completedAtMs - b.completedAtMs);
  return loaded;
}

function hasTerminalFailureSignal(artifact: EvaluatorCalibrationArtifact): boolean {
  return artifact.verdict === "fail" || artifact.terminalRunStatus === "failed";
}

function isHedgingOrFailing(artifact: EvaluatorCalibrationArtifact): boolean {
  return artifact.verdict === "pass_with_warnings" || hasTerminalFailureSignal(artifact);
}

type FollowUpFilter = (artifact: EvaluatorCalibrationArtifact) => boolean;

function overlappingFollowUp(
  base: LoadedArtifact,
  later: LoadedArtifact[],
  followUpWindowMs: number,
  accept: FollowUpFilter,
): { entry: LoadedArtifact; paths: string[] } | null {
  if (base.artifact.sourceFilesChanged.length === 0) return null;
  const baseFiles = new Set(base.artifact.sourceFilesChanged);
  const deadlineMs = base.completedAtMs + followUpWindowMs;
  for (const candidate of later) {
    if (candidate.completedAtMs <= base.completedAtMs) continue;
    if (candidate.completedAtMs > deadlineMs) break;
    if (!accept(candidate.artifact)) continue;
    const paths = candidate.artifact.sourceFilesChanged.filter((file) =>
      baseFiles.has(file)
    );
    if (paths.length > 0) return { entry: candidate, paths: [...new Set(paths)].sort() };
  }
  return null;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Compute evaluator drift over the rolling live-run window. */
export function aggregateCalibration(
  runsDir: string,
  options: AggregateCalibrationOptions,
): EvaluatorCalibrationAggregate {
  const nowMs = options.nowMs ?? Date.now();
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const followUpWindowMs = options.followUpWindowMs ?? DEFAULT_FOLLOW_UP_WINDOW_MS;
  const artifacts = loadCalibrationArtifactsInWindow(
    runsDir,
    windowMs,
    nowMs,
    options.criticPromptHash,
    options.authority,
  );
  const dispositions = loadEvaluatorCalibrationDispositions(runsDir);

  const byVerdict: Record<EvaluatorCalibrationVerdict, number> = {
    pass: 0,
    pass_with_warnings: 0,
    fail: 0,
    absent: 0,
  };
  const passContradictions: EvaluatorCalibrationContradiction[] = [];
  let passWithWarningsFollowUpCount = 0;

  for (let index = 0; index < artifacts.length; index++) {
    const entry = artifacts[index];
    const tail = artifacts.slice(index + 1);
    byVerdict[entry.artifact.verdict]++;
    if (entry.artifact.verdict === "pass") {
      const followUp = overlappingFollowUp(
        entry,
        tail,
        followUpWindowMs,
        hasTerminalFailureSignal,
      );
      if (followUp) {
        const contradiction: EvaluatorCalibrationContradiction = {
          base: {
            runId: entry.artifact.runId,
            taskId: entry.artifact.taskId,
            sourceRevision: entry.artifact.sourceRevision,
          },
          later: {
            runId: followUp.entry.artifact.runId,
            taskId: followUp.entry.artifact.taskId,
            sourceRevision: followUp.entry.artifact.sourceRevision,
          },
          laterFailure: {
            verdict: followUp.entry.artifact.verdict,
            terminalRunStatus: followUp.entry.artifact.terminalRunStatus,
          },
          overlappingSourcePaths: followUp.paths,
          disposition: null,
        };
        const baseRevision = contradiction.base.sourceRevision;
        const laterRevision = contradiction.later.sourceRevision;
        if (baseRevision !== null && laterRevision !== null) {
          contradiction.disposition = dispositions.get(
            evaluatorCalibrationDispositionKey({
              base: {
                runId: contradiction.base.runId,
                sourceRevision: baseRevision,
              },
              later: {
                runId: contradiction.later.runId,
                sourceRevision: laterRevision,
              },
            }),
          ) ?? null;
        }
        passContradictions.push(contradiction);
      }
    }
    if (
      entry.artifact.verdict === "pass_with_warnings" &&
      overlappingFollowUp(entry, tail, followUpWindowMs, isHedgingOrFailing)
    ) {
      passWithWarningsFollowUpCount++;
    }
  }

  return {
    windowStartMs: nowMs - windowMs,
    windowEndMs: nowMs,
    totalRuns: artifacts.length,
    byVerdict,
    passContradictionCount: passContradictions.length,
    passContradictionRate: rate(passContradictions.length, byVerdict.pass),
    passContradictions,
    passWithWarningsFollowUpCount,
    passWithWarningsFollowUpRate: rate(
      passWithWarningsFollowUpCount,
      byVerdict.pass_with_warnings,
    ),
  };
}

/** Apply both calibrated drift thresholds to an aggregate. */
export function evaluateCalibrationGate(
  aggregate: EvaluatorCalibrationAggregate,
  config: CalibrationGateConfig,
): CalibrationGateDecision {
  const passCount = aggregate.byVerdict.pass;
  const warningCount = aggregate.byVerdict.pass_with_warnings;
  const passSampleAdequate = passCount >= config.minSample;
  const warningSampleAdequate = warningCount >= config.passWithWarningsMinSample;

  if (!passSampleAdequate && !warningSampleAdequate) {
    return {
      status: "insufficient-sample",
      reason:
        `Only ${passCount} pass verdicts and ${warningCount} pass_with_warnings ` +
        `verdicts in window (minimums ${config.minSample} / ${config.passWithWarningsMinSample}).`,
    };
  }

  const kinds: CalibrationDriftKind[] = [];
  const reasons: string[] = [];
  if (
    passSampleAdequate &&
    aggregate.passContradictionRate > config.thresholdRate
  ) {
    kinds.push("pass-contradiction");
    reasons.push(
      `Pass-verdict contradiction rate ${(aggregate.passContradictionRate * 100).toFixed(1)}% ` +
        `exceeds threshold ${(config.thresholdRate * 100).toFixed(1)}% ` +
        `(${aggregate.passContradictionCount} of ${passCount} pass verdicts).`,
    );
  }
  if (
    warningSampleAdequate &&
    aggregate.passWithWarningsFollowUpRate > config.passWithWarningsThresholdRate
  ) {
    kinds.push("pass-with-warnings-escalation");
    reasons.push(
      `Pass-with-warnings follow-up rate ${(aggregate.passWithWarningsFollowUpRate * 100).toFixed(1)}% ` +
        `exceeds threshold ${(config.passWithWarningsThresholdRate * 100).toFixed(1)}% ` +
        `(${aggregate.passWithWarningsFollowUpCount} of ${warningCount} pass_with_warnings verdicts).`,
    );
  }
  if (kinds.length > 0) {
    return { status: "gated", reason: reasons.join(" "), kinds };
  }

  return {
    status: "under-threshold",
    reason:
      `Pass-verdict contradiction rate ${(aggregate.passContradictionRate * 100).toFixed(1)}% ` +
      `within threshold ${(config.thresholdRate * 100).toFixed(1)}%.`,
  };
}
