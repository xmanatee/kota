import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  concreteSignalPaths,
  requiredCausalFiles,
  verificationCases,
  verificationCommand,
} from "./debug-trace-contract.mjs";
import { validateChangedPaths } from "./debug-trace-git.mjs";

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateObservedBehavior(observations) {
  const issues = [];
  const byId = new Map(observations.map((entry) => [entry.id, entry]));
  for (const testCase of verificationCases) {
    const observed = byId.get(testCase.id);
    if (!isRecord(observed)) {
      issues.push(`missing observed behavior for ${testCase.id}`);
      continue;
    }
    if (typeof observed.error === "string") {
      issues.push(`${testCase.id} threw instead of routing through the ancestor rule: ${observed.error}`);
      continue;
    }
    for (const field of ["topic", "severity", "ruleKey", "owner"]) {
      if (observed[field] !== testCase.expected[field]) {
        issues.push(
          `${testCase.id} ${field} was ${JSON.stringify(observed[field])}, expected ${JSON.stringify(testCase.expected[field])}`,
        );
      }
    }
  }
  return issues;
}

export function validateChannelRegistrySource(source) {
  const issues = [];
  const hardcodedPaths = concreteSignalPaths.filter((path) => source.includes(path));
  if (hardcodedPaths.length > 0) {
    issues.push(
      `src/channel-registry.mjs must implement ancestor-prefix lookup, not hardcode concrete signal paths: ${hardcodedPaths.join(", ")}`,
    );
  }
  return issues;
}

export function validateArtifact(artifact, context) {
  const issues = [];
  if (!isRecord(artifact)) return ["debug-trace-result.json must contain a JSON object"];
  if (artifact.schemaVersion !== 1) issues.push("schemaVersion must be 1");

  const failing = isRecord(artifact.failingEvidence) ? artifact.failingEvidence : {};
  if (failing.command !== verificationCommand) {
    issues.push(`failingEvidence.command must be ${JSON.stringify(verificationCommand)}`);
  }
  if (failing.exitCode !== 1) {
    issues.push("failingEvidence.exitCode must record the initial non-zero test exit as 1");
  }
  if (
    typeof failing.outputExcerpt !== "string" ||
    !failing.outputExcerpt.includes("visible-line-a-pressure routed plant-alpha/line-a/press/pump-7") ||
    !failing.outputExcerpt.includes("queue/ambient-monitor") ||
    !failing.outputExcerpt.includes("queue/safety-cutoff")
  ) {
    issues.push("failingEvidence.outputExcerpt must quote the downstream line-a pressure routing failure");
  }

  const symptom = isRecord(artifact.symptom) ? artifact.symptom : {};
  if (symptom.file !== "src/gateway.mjs") issues.push("symptom.file must be src/gateway.mjs");
  if (symptom.layer !== "gateway dispatch") issues.push("symptom.layer must be gateway dispatch");
  if (typeof symptom.observed !== "string" || !symptom.observed.includes("queue/ambient-monitor")) {
    issues.push("symptom.observed must describe the downstream ambient-monitor dispatch");
  }

  const rootCause = isRecord(artifact.rootCause) ? artifact.rootCause : {};
  if (rootCause.file !== "src/channel-registry.mjs") issues.push("rootCause.file must be src/channel-registry.mjs");
  if (rootCause.layer !== "channel registry") issues.push("rootCause.layer must be channel registry");
  if (typeof rootCause.fix !== "string" || !rootCause.fix.includes("ancestor") || !rootCause.fix.includes("prefix")) {
    issues.push("rootCause.fix must describe restoring ancestor prefix lookup");
  }

  const causalPath = Array.isArray(artifact.causalPath) ? artifact.causalPath : [];
  for (const file of requiredCausalFiles) {
    if (!causalPath.some((entry) => typeof entry === "string" && entry.includes(file))) {
      issues.push(`causalPath must include ${file}`);
    }
  }
  if (causalPath.length < requiredCausalFiles.length) {
    issues.push(`causalPath must contain at least ${requiredCausalFiles.length} entries`);
  }

  const verification = isRecord(artifact.verification) ? artifact.verification : {};
  if (verification.command !== verificationCommand) {
    issues.push(`verification.command must be ${JSON.stringify(verificationCommand)}`);
  }
  if (verification.exitCode !== 0 || verification.status !== "passed") {
    issues.push("verification must record exitCode 0 and status passed");
  }
  if (verification.behaviorDigest !== context.expectedDigest) {
    issues.push(`verification.behaviorDigest must match current passing behavior ${context.expectedDigest}`);
  }
  if (
    !Array.isArray(verification.cases) ||
    verification.cases.length !== verificationCases.length ||
    !verificationCases.every((entry) => verification.cases.includes(entry.id))
  ) {
    issues.push("verification.cases must list every visible, hidden, adjacent, and holdout regression case");
  }

  const metrics = isRecord(artifact.metrics) ? artifact.metrics : {};
  if (metrics.causalPathCoverage !== requiredCausalFiles.length) {
    issues.push(`metrics.causalPathCoverage must be ${requiredCausalFiles.length}`);
  }
  if (metrics.regressionCasesPassed !== verificationCases.length) {
    issues.push(`metrics.regressionCasesPassed must be ${verificationCases.length}`);
  }

  validateChangedPaths(issues, context.changedPaths);
  const registrySource = readFileSync(join(context.scopeRoot, "src/channel-registry.mjs"), "utf8");
  issues.push(...validateChannelRegistrySource(registrySource));
  return issues;
}
