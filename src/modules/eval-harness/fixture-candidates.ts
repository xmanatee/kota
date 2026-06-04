import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  collectDuplicateCoverage,
  readRunEvidence,
} from "./fixture-candidates-artifacts.js";
import {
  malformedCandidate,
  toCandidate,
} from "./fixture-candidates-classify.js";
import {
  isJsonObject,
  parseString,
  readJsonValue,
} from "./fixture-candidates-json.js";

export type {
  FixtureCandidateCommand,
  FixtureCandidateMiningOptions,
  FixtureCandidateMiningResult,
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
  FixtureCandidateMiningOptions,
  FixtureCandidateMiningResult,
  FixtureCandidateRecord,
  FixtureCandidateReport,
} from "./fixture-candidates-types.js";

const DEFAULT_LIMIT = 20;

function resolveRunsDir(projectDir: string, options: FixtureCandidateMiningOptions): string {
  return options.runsDir === undefined
    ? join(projectDir, ".kota", "runs")
    : resolve(projectDir, options.runsDir);
}

function comparableRunTime(runDir: string): number {
  const metadataPath = join(runDir, "metadata.json");
  if (existsSync(metadataPath)) {
    try {
      const metadata = readJsonValue(metadataPath);
      const startedAt = isJsonObject(metadata) ? parseString(metadata.startedAt) : undefined;
      if (startedAt !== undefined) return Date.parse(startedAt);
    } catch {
      return statSync(runDir).mtimeMs;
    }
  }
  return statSync(runDir).mtimeMs;
}

function selectRunIds(
  runsDir: string,
  options: FixtureCandidateMiningOptions,
): readonly string[] {
  if (options.runIds !== undefined && options.runIds.length > 0) {
    return [...options.runIds].sort();
  }
  const sinceMs = options.since === undefined ? null : Date.parse(options.since);
  return readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      id: entry.name,
      comparableMs: comparableRunTime(join(runsDir, entry.name)),
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

function renderSummary(report: FixtureCandidateReport): string {
  const lines = [
    "# Fixture Candidates",
    "",
    `Runs scanned: ${report.totals.scannedRuns}`,
    `Viable: ${report.totals.viable}`,
    `Needs review: ${report.totals.needsReview}`,
    `Rejected: ${report.totals.rejected}`,
    "",
  ];
  for (const candidate of report.candidates) {
    lines.push(
      `## ${candidate.runId}`,
      "",
      `- workflow: ${candidate.workflow}`,
      `- status: ${candidate.status}`,
      `- reasons: ${candidate.reasonCodes.length === 0 ? "none" : candidate.reasonCodes.join(", ")}`,
      `- task: ${candidate.taskId ?? "unknown"}`,
      `- commands: ${candidate.terminalEvidence.commandCount}`,
      `- changed paths: ${candidate.changedPaths.length}`,
      `- verifier targets: ${candidate.verifierHints.stateTargets.length}`,
      "",
    );
    for (const command of candidate.terminalEvidence.commands.slice(0, 4)) {
      lines.push(`  - ${command.command}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function mineFixtureCandidates(
  projectDir: string,
  options: FixtureCandidateMiningOptions,
): FixtureCandidateMiningResult {
  const runsDir = resolveRunsDir(projectDir, options);
  const runIds = selectRunIds(runsDir, options);
  const coverage = collectDuplicateCoverage(projectDir);
  const candidates: FixtureCandidateRecord[] = [];
  for (const runId of runIds) {
    const runDir = join(runsDir, runId);
    try {
      const evidence = readRunEvidence(runDir);
      if (options.workflow !== undefined && evidence.metadata.workflow !== options.workflow) {
        continue;
      }
      candidates.push(
        toCandidate(evidence, coverage.coveredRunIds.get(evidence.metadata.id) ?? []),
      );
    } catch (err) {
      candidates.push(malformedCandidate(runId, err instanceof Error ? err.message : String(err)));
    }
  }
  candidates.sort((a, b) => a.runId.localeCompare(b.runId));
  const report: FixtureCandidateReport = {
    version: 1,
    input: {
      runsDir: relative(projectDir, runsDir) || ".",
      runIds,
      workflow: options.workflow ?? null,
      limit: options.limit ?? DEFAULT_LIMIT,
      since: options.since ?? null,
    },
    totals: reportTotals(candidates),
    candidates,
  };
  const outputDir = resolve(projectDir, options.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const jsonPath = join(outputDir, "fixture-candidates.json");
  const summaryPath = join(outputDir, "fixture-candidates.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(summaryPath, renderSummary(report));
  return { report, jsonPath, summaryPath };
}
