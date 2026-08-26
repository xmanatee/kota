import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dispatchAlert } from "../src/gateway.mjs";
import {
  requiredCausalFiles,
  validArtifactTemplate,
  verificationCases,
  verificationCommand,
} from "./debug-trace-contract.mjs";
import {
  validateArtifact,
  validateChannelRegistrySource,
  validateObservedBehavior,
} from "./debug-trace-artifact.mjs";
import { gitChangedPaths } from "./debug-trace-git.mjs";

function fail(message) {
  throw new Error(message);
}

function runVerificationCommand(scopeRoot) {
  return spawnSync(process.execPath, ["--test", "test/signal-flow.test.mjs"], {
    cwd: scopeRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10000,
  });
}

function normalizedTestOutput(run) {
  return [run.stdout, run.stderr].filter(Boolean).join("\n");
}

function observeBehavior() {
  return verificationCases.map((entry) => {
    try {
      const dispatched = dispatchAlert(entry.signal);
      return {
        id: entry.id,
        topic: dispatched.topic,
        severity: dispatched.payload.severity,
        ruleKey: dispatched.payload.ruleKey,
        owner: dispatched.payload.owner,
      };
    } catch (error) {
      return { id: entry.id, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

function behaviorDigest(observations) {
  return createHash("sha256").update(JSON.stringify(observations)).digest("hex");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function runBaselineFailureCheck(scopeRoot) {
  const run = runVerificationCommand(scopeRoot);
  if (run.status === 0) fail("baseline unexpectedly passed; fixture must start with a downstream routing failure");
  const output = normalizedTestOutput(run);
  const expectedNeedles = [
    "visible-line-a-pressure",
    "hidden-line-b-pressure",
    "adjacent-temperature-route",
    "queue/ambient-monitor",
    "queue/safety-cutoff",
  ];
  const missing = expectedNeedles.filter((needle) => !output.includes(needle));
  if (missing.length > 0) fail(`baseline failure output missing expected evidence: ${missing.join(", ")}`);
  console.log(JSON.stringify({ status: "ok", command: verificationCommand, failureNeedles: expectedNeedles }, null, 2));
}

function expectInvalidShortcut(scopeRoot, name, artifact, expectedMessage) {
  const issues = validateArtifact(artifact, {
    scopeRoot,
    expectedDigest: "expected-digest",
    changedPaths: ["debug-trace-result.json", "src/channel-registry.mjs"],
  });
  if (!issues.some((issue) => issue.includes(expectedMessage))) {
    fail(`${name} failed for the wrong reason. Expected ${JSON.stringify(expectedMessage)} in ${JSON.stringify(issues)}`);
  }
}

export function runShortcutSelfTest(scopeRoot) {
  const base = validArtifactTemplate();
  expectInvalidShortcut(
    scopeRoot,
    "symptom-as-root-cause",
    { ...base, rootCause: { file: "src/gateway.mjs", layer: "gateway dispatch", fix: "patch the observed output directly" } },
    "rootCause.file",
  );
  expectInvalidShortcut(
    scopeRoot,
    "missing-flow-layer",
    {
      ...base,
      causalPath: [
        "src/gateway.mjs: dispatchAlert exposed the wrong downstream queue",
        "src/channel-registry.mjs: resolveChannel skipped ancestor prefixes",
      ],
    },
    "src/signal-flow.mjs",
  );
  expectInvalidShortcut(
    scopeRoot,
    "fake-verification-digest",
    { ...base, verification: { ...base.verification, behaviorDigest: "not-the-current-run" } },
    "behaviorDigest",
  );
  const pathIssues = validateArtifact(base, {
    scopeRoot,
    expectedDigest: "placeholder",
    changedPaths: ["debug-trace-result.json", "src/gateway.mjs"],
  });
  if (!pathIssues.some((issue) => issue.includes("forbidden path src/gateway.mjs"))) {
    fail(`symptom-only changed-path shortcut was not rejected: ${JSON.stringify(pathIssues)}`);
  }
  const behaviorIssues = validateObservedBehavior([
    { id: "visible-line-a-pressure", topic: "queue/safety-cutoff", severity: "critical", ruleKey: "plant-alpha/line-a/press", owner: "pressure-safety" },
    { id: "hidden-line-b-pressure", topic: "queue/safety-cutoff", severity: "critical", ruleKey: "plant-alpha/line-b/press", owner: "pressure-safety" },
    { id: "adjacent-temperature-route", topic: "queue/thermal-watch", severity: "warning", ruleKey: "plant-alpha/line-a/temp", owner: "thermal-ops" },
    { id: "holdout-line-a-pressure-sibling", topic: "queue/ambient-monitor", severity: "info", ruleKey: "plant-alpha", owner: "site-ops" },
    { id: "holdout-line-b-pressure-sibling", topic: "queue/ambient-monitor", severity: "info", ruleKey: "plant-alpha", owner: "site-ops" },
    { id: "holdout-temperature-sibling", topic: "queue/ambient-monitor", severity: "info", ruleKey: "plant-alpha", owner: "site-ops" },
  ]);
  if (!behaviorIssues.some((issue) => issue.includes("holdout-line-a-pressure-sibling"))) {
    fail(`exact-path hardcoded behavior shortcut was not rejected: ${JSON.stringify(behaviorIssues)}`);
  }
  const sourceIssues = validateChannelRegistrySource("const routes = new Map([['plant-alpha/line-a/press/pump-7', {}]]);");
  if (!sourceIssues.some((issue) => issue.includes("must implement ancestor-prefix lookup"))) {
    fail(`concrete signal-path source shortcut was not rejected: ${JSON.stringify(sourceIssues)}`);
  }
  console.log(JSON.stringify({
    status: "passed",
    shortcutGuards: [
      "symptom-as-root-cause",
      "missing-flow-layer",
      "fake-verification-digest",
      "symptom-only-changed-path",
      "exact-path-behavior",
      "concrete-signal-path-source",
    ],
  }, null, 2));
}

export function runMainCheck(scopeRoot, artifactPath) {
  const run = runVerificationCommand(scopeRoot);
  if (run.status !== 0) {
    if (existsSync(artifactPath)) rmSync(artifactPath, { force: true });
    fail(`${verificationCommand} failed after candidate fix:\n${normalizedTestOutput(run)}`);
  }
  if (!existsSync(artifactPath)) fail("debug-trace-result.json is missing");

  const observations = observeBehavior();
  const behaviorIssues = validateObservedBehavior(observations);
  if (behaviorIssues.length > 0) fail(`post-fix behavior invalid:\n- ${behaviorIssues.join("\n- ")}`);
  const expectedDigest = behaviorDigest(observations);
  const artifact = readJson(artifactPath);
  const issues = validateArtifact(artifact, {
    scopeRoot,
    expectedDigest,
    changedPaths: gitChangedPaths(scopeRoot),
  });
  if (issues.length > 0) fail(`debug trace evidence invalid:\n- ${issues.join("\n- ")}`);
  console.log(JSON.stringify({
    status: "ok",
    command: verificationCommand,
    artifact: "debug-trace-result.json",
    behaviorDigest: expectedDigest,
    cases: verificationCases.length,
    causalPathCoverage: requiredCausalFiles.length,
  }, null, 2));
}
