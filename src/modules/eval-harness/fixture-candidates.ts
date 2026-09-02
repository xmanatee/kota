import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { enumerateWorkflowRunMetadataWithDurableAuthority } from "#core/workflow/run-operational-projection.js";
import { readRunEvidence } from "./fixture-candidates-artifacts.js";
import {
  malformedCandidate,
  toCandidate,
} from "./fixture-candidates-classify.js";
import { collectDuplicateCoverage } from "./fixture-candidates-duplicates.js";
import { createCandidateTask } from "./fixture-candidates-task-writer.js";

export type {
  FixtureCandidateAcceptedAction,
  FixtureCandidateCommand,
  FixtureCandidateDisposition,
  FixtureCandidateDuplicateReference,
  FixtureCandidateEvaluatorType,
  FixtureCandidateMiningOptions,
  FixtureCandidateMiningResult,
  FixtureCandidatePattern,
  FixtureCandidatePatternKind,
  FixtureCandidateReasonCode,
  FixtureCandidateRecord,
  FixtureCandidateReport,
  FixtureCandidateReproducibility,
  FixtureCandidateSafety,
  FixtureCandidateStatus,
  FixtureCandidateStructuredArtifact,
  FixtureCandidateVerifierHints,
} from "./fixture-candidates-types.js";
export {
  FIXTURE_CANDIDATE_REASON_CODES,
} from "./fixture-candidates-types.js";

import type {
  FixtureCandidateDisposition,
  FixtureCandidateDuplicateReference,
  FixtureCandidateMiningOptions,
  FixtureCandidateMiningResult,
  FixtureCandidateRecord,
  FixtureCandidateReport,
  RunEvidence,
} from "./fixture-candidates-types.js";

const DEFAULT_LIMIT = 20;

function resolveRunsDir(workspaceRoot: string, options: FixtureCandidateMiningOptions): string {
  return options.runsDir === undefined
    ? join(workspaceRoot, ".kota", "runs")
    : resolve(workspaceRoot, options.runsDir);
}

function comparableRunTime(runDir: string): number {
  return statSync(runDir).mtimeMs;
}

function selectRunIds(
  workspaceRoot: string,
  runsDir: string,
  options: FixtureCandidateMiningOptions,
): readonly string[] {
  const runs = enumerateWorkflowRunMetadataWithDurableAuthority({
    runsDir,
    stateDir: join(workspaceRoot, ".kota"),
    scopeRoot: workspaceRoot,
  }).runs;
  if (options.runIds !== undefined && options.runIds.length > 0) {
    const requested = new Set(options.runIds);
    return runs
      .map((run) => run.id)
      .filter((runId) => requested.has(runId))
      .sort();
  }
  const sinceMs = options.since === undefined ? null : Date.parse(options.since);
  return runs
    .map((run) => ({
      id: run.id,
      comparableMs: Number.isFinite(Date.parse(run.startedAt))
        ? Date.parse(run.startedAt)
        : comparableRunTime(join(runsDir, run.id)),
    }))
    .filter((entry) => sinceMs === null || entry.comparableMs >= sinceMs)
    .sort((a, b) => b.comparableMs - a.comparableMs || a.id.localeCompare(b.id))
    .slice(0, options.limit ?? DEFAULT_LIMIT)
    .map((entry) => entry.id)
    .sort();
}

function reportTotals(candidates: readonly FixtureCandidateRecord[]): FixtureCandidateReport["totals"] {
  return {
    scannedRuns: candidates.length,
    viable: candidates.filter((candidate) => candidate.status === "viable").length,
    needsReview: candidates.filter((candidate) => candidate.status === "needs-review").length,
    rejected: candidates.filter((candidate) => candidate.status === "rejected").length,
  };
}

function dispositionTotals(
  candidates: readonly FixtureCandidateRecord[],
): Record<FixtureCandidateDisposition, number> {
  return {
    proposed: candidates.filter((candidate) => candidate.disposition === "proposed").length,
    accepted: candidates.filter((candidate) => candidate.disposition === "accepted").length,
    rejected: candidates.filter((candidate) => candidate.disposition === "rejected").length,
    duplicate: candidates.filter((candidate) => candidate.disposition === "duplicate").length,
    "needs-owner-evidence": candidates.filter((candidate) =>
      candidate.disposition === "needs-owner-evidence"
    ).length,
  };
}

function uniqueTaskReferences(
  references: readonly FixtureCandidateDuplicateReference[],
): readonly FixtureCandidateDuplicateReference[] {
  const byKey = new Map<string, FixtureCandidateDuplicateReference>();
  for (const reference of references) {
    byKey.set(`${reference.kind}:${reference.id}:${reference.path}`, reference);
  }
  return [...byKey.values()].sort((a, b) =>
    a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path) || a.id.localeCompare(b.id)
  );
}

function toCandidateWithDuplicateCoverage(
  evidence: RunEvidence,
  coverage: ReturnType<typeof collectDuplicateCoverage>,
  patternOccurrenceCounts: ReadonlyMap<string, number>,
): FixtureCandidateRecord {
  const duplicateFixtures = coverage.coveredRunIds.get(evidence.metadata.id) ?? [];
  const duplicateRunTasks = coverage.taskReferencesByRunId.get(evidence.metadata.id) ?? [];
  let candidate = toCandidate(evidence, {
    duplicateFixtures,
    duplicateTaskReferences: duplicateRunTasks,
    patternOccurrenceCounts,
  });
  const duplicateFingerprintTasks =
    coverage.taskReferencesByFingerprint.get(candidate.proposalFingerprint) ?? [];
  if (duplicateFingerprintTasks.length > 0) {
    candidate = toCandidate(evidence, {
      duplicateFixtures,
      duplicateTaskReferences: uniqueTaskReferences([
        ...duplicateRunTasks,
        ...duplicateFingerprintTasks,
      ]),
      patternOccurrenceCounts,
    });
  }
  return candidate;
}

function collectPatternOccurrenceCounts(
  evidences: readonly RunEvidence[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const evidence of evidences) {
    for (const signal of evidence.patternSignals) {
      counts.set(signal.signature, (counts.get(signal.signature) ?? 0) + 1);
    }
  }
  return counts;
}

function renderSummary(report: FixtureCandidateReport): string {
  const lines = [
    "# Fixture Candidates",
    "",
    `Runs scanned: ${report.totals.scannedRuns}`,
    `Viable: ${report.totals.viable}`,
    `Needs review: ${report.totals.needsReview}`,
    `Rejected: ${report.totals.rejected}`,
    `Proposed: ${report.dispositionTotals.proposed}`,
    `Accepted: ${report.dispositionTotals.accepted}`,
    `Duplicate: ${report.dispositionTotals.duplicate}`,
    `Needs owner evidence: ${report.dispositionTotals["needs-owner-evidence"]}`,
    "",
  ];
  for (const candidate of report.candidates) {
    lines.push(
      `## ${candidate.runId}`,
      "",
      `- workflow: ${candidate.workflow}`,
      `- status: ${candidate.status}`,
      `- disposition: ${candidate.disposition}`,
      `- pattern: ${candidate.failurePattern.kind}`,
      `- evaluator: ${candidate.suggestedEvaluator}`,
      `- reasons: ${candidate.reasonCodes.length === 0 ? "none" : candidate.reasonCodes.join(", ")}`,
      `- task: ${candidate.taskId ?? "unknown"}`,
      `- commands: ${candidate.terminalEvidence.commandCount}`,
      `- changed paths: ${candidate.changedPaths.length}`,
      `- verifier targets: ${candidate.verifierHints.stateTargets.length}`,
      `- evidence: ${candidate.failurePattern.evidencePaths.join(", ") || "metadata only"}`,
      "",
    );
    if (candidate.duplicateReferences.length > 0) {
      lines.push("  duplicates:");
      for (const reference of candidate.duplicateReferences.slice(0, 4)) {
        lines.push(`  - ${reference.kind}:${reference.id} ${reference.path}`);
      }
      lines.push("");
    }
    if (candidate.acceptedAction !== null) {
      lines.push(`  accepted task: ${candidate.acceptedAction.path}`, "");
    }
    for (const command of candidate.terminalEvidence.commands.slice(0, 4)) {
      lines.push(`  - ${command.command}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function mineFixtureCandidates(
  workspaceRoot: string,
  options: FixtureCandidateMiningOptions,
): FixtureCandidateMiningResult {
  const runsDir = resolveRunsDir(workspaceRoot, options);
  const runIds = selectRunIds(workspaceRoot, runsDir, options);
  const coverage = collectDuplicateCoverage(workspaceRoot);
  const evidences: RunEvidence[] = [];
  const malformedCandidates: FixtureCandidateRecord[] = [];
  for (const runId of runIds) {
    const runDir = join(runsDir, runId);
    try {
      const evidence = readRunEvidence(runDir);
      if (options.workflow !== undefined && evidence.metadata.workflow !== options.workflow) {
        continue;
      }
      evidences.push(evidence);
    } catch (err) {
      malformedCandidates.push(malformedCandidate(runId, err instanceof Error ? err.message : String(err)));
    }
  }
  const patternOccurrenceCounts = collectPatternOccurrenceCounts(evidences);
  let candidates: FixtureCandidateRecord[] = [
    ...evidences.map((evidence) =>
      toCandidateWithDuplicateCoverage(evidence, coverage, patternOccurrenceCounts)
    ),
    ...malformedCandidates,
  ];
  if (options.createTask === true) {
    const nowIso = options.nowIso ?? new Date().toISOString();
    candidates = candidates.map((candidate) => {
      const acceptedAction = createCandidateTask(workspaceRoot, candidate, nowIso);
      return acceptedAction === null
        ? candidate
        : { ...candidate, disposition: "accepted", acceptedAction };
    });
  }
  candidates.sort((a, b) => a.runId.localeCompare(b.runId));
  const report: FixtureCandidateReport = {
    version: 1,
    input: {
      runsDir: relative(workspaceRoot, runsDir) || ".",
      runIds,
      workflow: options.workflow ?? null,
      limit: options.limit ?? DEFAULT_LIMIT,
      since: options.since ?? null,
      createTask: options.createTask === true,
    },
    dispositionTotals: dispositionTotals(candidates),
    totals: reportTotals(candidates),
    candidates,
  };
  const outputDir = resolve(workspaceRoot, options.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, "fixture-candidates.json");
  const summaryPath = join(outputDir, "fixture-candidates.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(summaryPath, renderSummary(report));
  return { report, jsonPath, summaryPath };
}
