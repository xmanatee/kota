#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

const ALLOWED_METRIC_KEYS = new Set([
  "total_cases",
  "good_cases_passed",
  "bad_cases_caught",
  "violations_found",
]);

const EXPECTED_BAD_VIOLATIONS = new Map([
  ["bad-refund-without-tool", "missing-required-tool-call"],
  ["bad-pii-leak", "pii-leak"],
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    casesDir: "cases",
    outputPath: "artifacts/evaluation-result.json",
    metricOnly: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cases") {
      parsed.casesDir = argv[i + 1] ?? fail("--cases requires a path");
      i += 1;
      continue;
    }
    if (arg === "--output") {
      parsed.outputPath = argv[i + 1] ?? fail("--output requires a path");
      i += 1;
      continue;
    }
    if (arg === "--metric-only") {
      parsed.metricOnly = argv[i + 1] ?? fail("--metric-only requires a metric name");
      i += 1;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function walkJsonFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkJsonFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function loadCaseExpectations(casesDir) {
  if (!existsSync(casesDir) || !statSync(casesDir).isDirectory()) {
    fail(`cases directory missing: ${casesDir}`);
  }
  const cases = [];
  for (const filePath of walkJsonFiles(casesDir)) {
    const testCase = JSON.parse(readFileSync(filePath, "utf8"));
    if (typeof testCase.id !== "string" || testCase.id.length === 0) {
      fail(`case ${filePath} must declare a non-empty string id`);
    }
    const rel = relative(casesDir, filePath);
    const expected = rel.startsWith(`good/`) ? "pass" : rel.startsWith(`bad/`) ? "fail" : null;
    if (expected === null) {
      fail(`case ${filePath} must live under cases/good/ or cases/bad/`);
    }
    cases.push({ id: testCase.id, expected, filePath });
  }
  if (!cases.some((testCase) => testCase.expected === "pass")) {
    fail("at least one good case is required");
  }
  if (!cases.some((testCase) => testCase.expected === "fail")) {
    fail("at least one bad case is required");
  }
  return cases;
}

function readResult(outputPath) {
  if (!existsSync(outputPath)) {
    fail(`evaluation result artifact missing: ${outputPath}`);
  }
  const raw = readFileSync(outputPath, "utf8");
  if (raw.trim().length === 0) {
    fail(`evaluation result artifact is empty: ${outputPath}`);
  }
  if (raw.length > 12000) {
    fail(`evaluation result artifact is too large: ${raw.length} bytes`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    fail(`evaluation result artifact is not JSON: ${err.message}`);
  }
}

function ensurePlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be a JSON object`);
  }
  return value;
}

function validateCaseResults(result, expectedCases) {
  if (!Array.isArray(result.cases)) {
    fail("result.cases must be an array");
  }
  if (result.cases.length !== expectedCases.length) {
    fail(`result.cases has ${result.cases.length} entries, expected ${expectedCases.length}`);
  }

  const byId = new Map();
  for (const entry of result.cases) {
    ensurePlainObject(entry, "case result");
    if (typeof entry.id !== "string") fail("case result id must be a string");
    if (entry.expected !== "pass" && entry.expected !== "fail") {
      fail(`case ${entry.id} expected must be "pass" or "fail"`);
    }
    if (typeof entry.passed !== "boolean") {
      fail(`case ${entry.id} passed must be a boolean`);
    }
    if (
      !Array.isArray(entry.violations) ||
      !entry.violations.every((violation) => typeof violation === "string")
    ) {
      fail(`case ${entry.id} violations must be an array of strings`);
    }
    if (byId.has(entry.id)) fail(`duplicate case result id: ${entry.id}`);
    byId.set(entry.id, entry);
  }

  let goodCasesPassed = 0;
  let badCasesCaught = 0;
  let violationsFound = 0;
  for (const expectedCase of expectedCases) {
    const actual = byId.get(expectedCase.id);
    if (actual === undefined) fail(`missing result for case ${expectedCase.id}`);
    if (actual.expected !== expectedCase.expected) {
      fail(`case ${expectedCase.id} expected=${actual.expected}, should be ${expectedCase.expected}`);
    }
    if (expectedCase.expected === "pass") {
      if (actual.passed !== true) fail(`good case ${expectedCase.id} did not pass`);
      if (actual.violations.length !== 0) {
        fail(`good case ${expectedCase.id} reported violations`);
      }
      goodCasesPassed += 1;
      continue;
    }

    if (actual.passed !== false) fail(`bad case ${expectedCase.id} was not caught`);
    const expectedViolation = EXPECTED_BAD_VIOLATIONS.get(expectedCase.id);
    if (expectedViolation === undefined) {
      fail(`checker has no expected violation for bad case ${expectedCase.id}`);
    }
    if (!actual.violations.includes(expectedViolation)) {
      fail(
        `bad case ${expectedCase.id} must include violation ${expectedViolation}; got ${actual.violations.join(", ")}`,
      );
    }
    badCasesCaught += 1;
    violationsFound += actual.violations.length;
  }

  return { goodCasesPassed, badCasesCaught, violationsFound };
}

function validateMetrics(result, expectedCases, observed) {
  const metrics = ensurePlainObject(result.metrics, "result.metrics");
  const keys = Object.keys(metrics);
  if (keys.length === 0) fail("result.metrics must contain bounded numeric evidence");
  if (keys.length > ALLOWED_METRIC_KEYS.size) {
    fail(`result.metrics has ${keys.length} keys; allowed maximum is ${ALLOWED_METRIC_KEYS.size}`);
  }
  for (const key of keys) {
    if (!ALLOWED_METRIC_KEYS.has(key)) {
      fail(`result.metrics contains unrelated metric key: ${key}`);
    }
    const value = metrics[key];
    if (!Number.isFinite(value) || value < 0) {
      fail(`result.metrics.${key} must be a non-negative finite number`);
    }
  }

  const requiredMetrics = {
    total_cases: expectedCases.length,
    good_cases_passed: observed.goodCasesPassed,
    bad_cases_caught: observed.badCasesCaught,
  };
  for (const [key, value] of Object.entries(requiredMetrics)) {
    if (metrics[key] !== value) {
      fail(`result.metrics.${key} must be ${value}, got ${JSON.stringify(metrics[key])}`);
    }
  }
  if (
    "violations_found" in metrics &&
    metrics.violations_found !== observed.violationsFound
  ) {
    fail(
      `result.metrics.violations_found must be ${observed.violationsFound}, got ${JSON.stringify(metrics.violations_found)}`,
    );
  }
  return metrics;
}

function runEvaluator({ casesDir, outputPath }) {
  const evaluatorPath = "scripts/evaluate-traces.mjs";
  if (!existsSync(evaluatorPath)) {
    fail(`missing evaluator: ${evaluatorPath}`);
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  rmSync(outputPath, { force: true });
  const result = spawnSync(
    process.execPath,
    [evaluatorPath, "--cases", casesDir, "--output", outputPath],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.status !== 0 || result.error !== undefined) {
    const detail = [result.stdout, result.stderr, result.error?.message]
      .filter((part) => part !== undefined && part.length > 0)
      .join("\n")
      .trim();
    fail(`evaluation command failed${detail ? `:\n${detail}` : ""}`);
  }
}

const args = parseArgs(process.argv.slice(2));
const expectedCases = loadCaseExpectations(args.casesDir);
runEvaluator(args);
const result = ensurePlainObject(readResult(args.outputPath), "evaluation result");
if (result.schemaVersion !== 1) {
  fail(`result.schemaVersion must be 1, got ${JSON.stringify(result.schemaVersion)}`);
}
const observed = validateCaseResults(result, expectedCases);
const metrics = validateMetrics(result, expectedCases, observed);

if (args.metricOnly !== null) {
  const key = args.metricOnly.replaceAll("-", "_");
  if (!(key in metrics)) {
    fail(`metric ${args.metricOnly} not found`);
  }
  console.log(metrics[key]);
} else {
  console.log(
    JSON.stringify(
      {
        status: "ok",
        total_cases: expectedCases.length,
        good_cases_passed: observed.goodCasesPassed,
        bad_cases_caught: observed.badCasesCaught,
        metric_keys: Object.keys(metrics).sort(),
      },
      null,
      2,
    ),
  );
}
