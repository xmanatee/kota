import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
export const resultPath = join(projectRoot, "feature-slice-result.json");
export const testFile = "test/feature-slice.test.mjs";
export const requiredFeatureCases = [
  "gift-wrap-fee-and-receipt",
  "gift-wrap-fulfillment-metadata",
  "catalog-backed-service-contract",
];
export const requiredRegressionCases = [
  "bulk-discount-preserved",
  "free-shipping-preserved",
  "receipt-format-preserved",
];
export const requiredChangedModules = [
  "src/catalog.mjs",
  "src/pricing.mjs",
  "src/receipt-renderer.mjs",
];

export class CheckError extends Error {
  constructor(message) {
    super(message);
    this.name = "CheckError";
  }
}

export function fail(message) {
  throw new CheckError(message);
}

function runCommand(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  return {
    command: `node ${args.join(" ")}`,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error?.message,
  };
}

export function runNodeTests(pattern) {
  return runCommand(["--test", "--test-name-pattern", pattern, testFile]);
}

export function tail(value) {
  return value.length > 1800 ? value.slice(-1800) : value;
}

export function requirePassingRun(result, label) {
  if (result.status !== 0 || result.error !== undefined) {
    fail(
      `${label} failed:\nstdout:\n${tail(result.stdout)}\nstderr:\n${tail(result.stderr)}`,
    );
  }
}

export function ensureObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be a JSON object`);
  }
  return value;
}

function validateCaseSet(cases, expectedIds, label) {
  if (!Array.isArray(cases)) {
    fail(`${label} must be an array`);
  }
  const seen = new Set();
  for (const entry of cases) {
    ensureObject(entry, `${label} entry`);
    if (!expectedIds.includes(entry.id)) {
      fail(`${label} contains unexpected case id: ${JSON.stringify(entry.id)}`);
    }
    if (seen.has(entry.id)) {
      fail(`${label} duplicates case id: ${entry.id}`);
    }
    seen.add(entry.id);
    if (entry.passed !== true) {
      fail(`${label} case ${entry.id} did not pass`);
    }
  }
  for (const id of expectedIds) {
    if (!seen.has(id)) {
      fail(`${label} missing case id: ${id}`);
    }
  }
}

export function validateEvidence(evidence) {
  ensureObject(evidence, "feature-slice evidence");
  if (evidence.schemaVersion !== 1) {
    fail("feature-slice evidence schemaVersion must be 1");
  }
  if (evidence.status !== "passed") {
    fail("feature-slice evidence status must be passed");
  }

  const feature = ensureObject(evidence.featureBehavior, "featureBehavior");
  if (feature.id !== "gift-wrap-checkout-slice") {
    fail("featureBehavior.id must be gift-wrap-checkout-slice");
  }
  validateCaseSet(
    feature.cases,
    requiredFeatureCases,
    "featureBehavior.cases",
  );
  validateCaseSet(
    evidence.regressionBehaviors,
    requiredRegressionCases,
    "regressionBehaviors",
  );

  if (!Array.isArray(evidence.commandsRun) || evidence.commandsRun.length < 2) {
    fail("commandsRun must record feature and regression test commands");
  }
  if (!Array.isArray(evidence.filesOrModulesInvolved)) {
    fail("filesOrModulesInvolved must be an array");
  }
  for (const modulePath of requiredChangedModules) {
    if (!evidence.filesOrModulesInvolved.includes(modulePath)) {
      fail(`filesOrModulesInvolved missing required module: ${modulePath}`);
    }
  }

  const metrics = ensureObject(evidence.metrics, "metrics");
  if (metrics.featureCasesPassed !== requiredFeatureCases.length) {
    fail("metrics.featureCasesPassed does not match required feature cases");
  }
  if (metrics.regressionCasesPassed !== requiredRegressionCases.length) {
    fail(
      "metrics.regressionCasesPassed does not match required regression cases",
    );
  }
  if (metrics.touchedModuleCoverage !== requiredChangedModules.length) {
    fail("metrics.touchedModuleCoverage must prove all required modules changed");
  }
}

export function writeEvidence(evidence) {
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify(evidence, null, 2)}\n`);
}
