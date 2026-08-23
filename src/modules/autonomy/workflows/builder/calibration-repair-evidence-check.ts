import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  KotaJsonObject,
  KotaJsonValue,
} from "#core/agent-harness/message-protocol.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { CALIBRATION_REPAIR_TASK_ID } from "#modules/autonomy/calibration-repair.js";
import {
  type EvaluatorCalibrationAggregate,
  evaluateCalibrationGate,
  resolveCalibrationGateConfig,
} from "#modules/autonomy/evaluator-calibration.js";
import type { QueueTaskClaimResult } from "#modules/autonomy/task-claims.js";
import {
  BUILDER_EVIDENCE_MANIFEST_FILE,
  parseBuilderEvidenceManifest,
} from "./agent-run-evidence-manifest.js";
import { verifyCalibrationWeakEvidenceDisposition } from "./calibration-repair-disposition.js";

export const CALIBRATION_REPAIR_EVIDENCE_CHECK_ID =
  "calibration-repair-evidence";

const SOURCE_REF = new RegExp(
  `^git:([a-f0-9]{40}):(data/tasks/(?:ready|doing|done)/${CALIBRATION_REPAIR_TASK_ID}\\.md)$`,
);

function fail(message: string): never {
  throw new Error(`Calibration repair evidence ${message}`);
}

function objectField(
  value: KotaJsonValue | undefined,
  label: string,
): KotaJsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`must contain object field ${label}.`);
  }
  return value;
}

function stringField(object: KotaJsonObject, key: string): string {
  const value = object[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`must contain non-empty string field ${key}.`);
  }
  return value;
}

function requireValue(
  object: KotaJsonObject,
  key: string,
  expected: string | number,
): void {
  if (object[key] !== expected) {
    fail(`field ${key} must equal ${JSON.stringify(expected)}.`);
  }
}

function taskAtSourceRef(projectDir: string, sourceRef: string): string {
  const match = SOURCE_REF.exec(sourceRef);
  if (!match) fail("sourceRef must cite the calibration task at a full Git revision.");
  const result = spawnSync("git", ["show", `${match[1]}:${match[2]}`], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0 || result.stdout.length === 0) {
    fail(`cannot resolve monitor snapshot ${sourceRef}.`);
  }
  return result.stdout;
}

function assertCurrentRepairSource(projectDir: string, sourceRef: string): void {
  const revision = SOURCE_REF.exec(sourceRef)?.[1];
  const sourcePath = `data/tasks/ready/${CALIBRATION_REPAIR_TASK_ID}.md`;
  const result = spawnSync(
    "git",
    ["log", "-1", "--format=%H", "HEAD", "--", sourcePath],
    {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0 || result.stdout.trim() !== revision) {
    fail("sourceRef is unrelated to the claimed task's monitor snapshot.");
  }
}

function matchedNumber(content: string, pattern: RegExp, label: string): number {
  const raw = pattern.exec(content)?.[1];
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) fail(`source task is missing ${label}.`);
  return value;
}

function aggregateFromTask(content: string): EvaluatorCalibrationAggregate {
  const window = /- Window: ([^ ]+) → ([^\n]+)/.exec(content);
  if (!window) fail("source task is missing its calibration window.");
  const windowStartMs = Date.parse(window[1]);
  const windowEndMs = Date.parse(window[2]);
  if (!Number.isFinite(windowStartMs) || !Number.isFinite(windowEndMs)) {
    fail("source task has an invalid calibration window.");
  }
  const aggregate: EvaluatorCalibrationAggregate = {
    windowStartMs,
    windowEndMs,
    totalRuns: matchedNumber(content, /- Total runs in window: (\d+)/, "total runs"),
    byVerdict: {
      pass: matchedNumber(content, /- Pass verdicts: (\d+)/, "pass verdicts"),
      pass_with_warnings: matchedNumber(
        content,
        /- Pass-with-warnings verdicts: (\d+)/,
        "pass-with-warnings verdicts",
      ),
      fail: matchedNumber(content, /- Fail verdicts: (\d+)/, "fail verdicts"),
      absent: matchedNumber(content, /- Absent verdicts: (\d+)/, "absent verdicts"),
    },
    passContradictionCount: matchedNumber(
      content,
      /- Pass-contradiction rate: [\d.]+% \((\d+) of \d+\)/,
      "pass-contradiction count",
    ),
    passContradictionRate:
      matchedNumber(
        content,
        /- Pass-contradiction rate: ([\d.]+)%/,
        "pass-contradiction rate",
      ) / 100,
    passWithWarningsFollowUpCount: matchedNumber(
      content,
      /- Pass-with-warnings follow-up rate: [\d.]+% \((\d+) of \d+\)/,
      "pass-with-warnings follow-up count",
    ),
    passWithWarningsFollowUpRate:
      matchedNumber(
        content,
        /- Pass-with-warnings follow-up rate: ([\d.]+)%/,
        "pass-with-warnings follow-up rate",
      ) / 100,
  };
  const verdictTotal = Object.values(aggregate.byVerdict).reduce(
    (sum, count) => sum + count,
    0,
  );
  const contradictionRate =
    aggregate.byVerdict.pass === 0
      ? 0
      : aggregate.passContradictionCount / aggregate.byVerdict.pass;
  if (
    verdictTotal !== aggregate.totalRuns ||
    Math.abs(contradictionRate - aggregate.passContradictionRate) > 0.0005
  ) {
    fail("source task has an incoherent calibration aggregate.");
  }
  return aggregate;
}

function assertAggregate(
  object: KotaJsonObject,
  expected: EvaluatorCalibrationAggregate,
): void {
  requireValue(object, "windowStartMs", expected.windowStartMs);
  requireValue(object, "windowEndMs", expected.windowEndMs);
  requireValue(object, "totalRuns", expected.totalRuns);
  const byVerdict = objectField(object.byVerdict, "aggregate.byVerdict");
  for (const verdict of [
    "pass",
    "pass_with_warnings",
    "fail",
    "absent",
  ] as const) {
    requireValue(byVerdict, verdict, expected.byVerdict[verdict]);
  }
  requireValue(
    object,
    "passContradictionCount",
    expected.passContradictionCount,
  );
  requireValue(object, "passContradictionRate", expected.passContradictionRate);
  requireValue(
    object,
    "passWithWarningsFollowUpCount",
    expected.passWithWarningsFollowUpCount,
  );
  requireValue(
    object,
    "passWithWarningsFollowUpRate",
    expected.passWithWarningsFollowUpRate,
  );
}

function verifyGateRetune(projectDir: string, artifact: KotaJsonObject): string {
  requireValue(artifact, "schemaVersion", 1);
  requireValue(artifact, "artifactType", "evaluator-calibration-repair");
  requireValue(artifact, "evidenceKind", "gate-retune");
  requireValue(artifact, "taskId", CALIBRATION_REPAIR_TASK_ID);
  requireValue(artifact, "workflow", "builder");

  const source = objectField(artifact.sourceSnapshot, "sourceSnapshot");
  requireValue(source, "gateStatus", "gated");
  const sourceRef = stringField(source, "sourceRef");
  assertCurrentRepairSource(projectDir, sourceRef);
  const sourceTask = taskAtSourceRef(projectDir, sourceRef);
  const aggregate = aggregateFromTask(sourceTask);
  if (aggregate.totalRuns <= 0) fail("source snapshot has an empty aggregate.");
  assertAggregate(objectField(source.aggregate, "sourceSnapshot.aggregate"), aggregate);
  assertAggregate(objectField(artifact.aggregate, "aggregate"), aggregate);

  const activeConfig = resolveCalibrationGateConfig();
  const candidate = objectField(artifact.candidateConfig, "candidateConfig");
  for (const key of [
    "thresholdRate",
    "minSample",
    "passWithWarningsThresholdRate",
    "passWithWarningsMinSample",
  ] as const) {
    requireValue(candidate, key, activeConfig[key]);
  }
  const decision = evaluateCalibrationGate(aggregate, activeConfig);
  if (decision.status === "gated") fail(`remains gated: ${decision.reason}`);
  requireValue(artifact, "gateStatus", decision.status);
  requireValue(artifact, "decisionReason", decision.reason);
  if (stringField(artifact, "rationale").length < 80) {
    fail("must record a substantive gate-retune rationale.");
  }

  const historicalRefs = artifact.historicalMonitorRefs;
  if (!Array.isArray(historicalRefs) || historicalRefs.length < 2) {
    fail("must cite at least two prior monitor snapshots for a gate retune.");
  }
  const distinctHistoricalRefs = new Set(historicalRefs);
  if (distinctHistoricalRefs.size < 2) {
    fail("must cite two distinct prior monitor snapshots for a gate retune.");
  }
  const historicalAggregates: EvaluatorCalibrationAggregate[] = [];
  for (const ref of distinctHistoricalRefs) {
    if (typeof ref !== "string") fail("historicalMonitorRefs must be strings.");
    historicalAggregates.push(aggregateFromTask(taskAtSourceRef(projectDir, ref)));
  }
  const hasStableAdequateWindow = historicalAggregates.some(
    (entry) =>
      entry.byVerdict.pass >= activeConfig.minSample &&
      entry.passContradictionRate <= activeConfig.thresholdRate,
  );
  const hasVolatileSmallWindow = historicalAggregates.some(
    (entry) =>
      entry.byVerdict.pass < activeConfig.minSample &&
      entry.passContradictionRate > activeConfig.thresholdRate,
  );
  if (!hasStableAdequateWindow || !hasVolatileSmallWindow) {
    fail("monitor history must show both a stable adequate window and a volatile small window.");
  }
  const followUpTaskCount = verifyCalibrationWeakEvidenceDisposition({
    projectDir,
    artifact,
    sourceRef,
    weakEvidenceCount:
      aggregate.passContradictionCount +
      aggregate.passWithWarningsFollowUpCount,
  });
  return (
    `OK: calibration gate retune preserves ${aggregate.totalRuns} source run(s), ` +
    `assigns weak evidence to ${followUpTaskCount} follow-up task(s), and resolves ${decision.status}`
  );
}

export function checkCalibrationRepairEvidence(
  projectDir: string,
  agentRunDir: string,
  claim: QueueTaskClaimResult | undefined,
): string {
  if (claim?.taskId !== CALIBRATION_REPAIR_TASK_ID) {
    return "OK: claimed task is not an evaluator-calibration repair";
  }
  const manifestPath = join(agentRunDir, BUILDER_EVIDENCE_MANIFEST_FILE);
  if (!existsSync(manifestPath)) fail("manifest is missing.");
  const registered = parseBuilderEvidenceManifest(
    readFileSync(manifestPath),
  ).some(
    (entry) => entry.path === "calibration-repair.json" && entry.kind === "json",
  );
  if (!registered) fail("must register calibration-repair.json as JSON.");
  const artifactPath = join(agentRunDir, "artifacts", "calibration-repair.json");
  const artifact = readOptionalJsonFile<KotaJsonValue>(artifactPath);
  if (artifact === null) fail("is missing.");
  return verifyGateRetune(projectDir, objectField(artifact, "root"));
}
