#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeProjectCode } from "../src/project-code.mjs";

const args = new Set(process.argv.slice(2));

function optionNumber(name) {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (inline !== undefined) return Number(inline.slice(prefix.length));
  const index = process.argv.indexOf(name);
  if (index >= 0) return Number(process.argv[index + 1]);
  return null;
}

function behaviorFailures() {
  const failures = [];
  const cases = [
    ["  North_Wind / 42 ", "north-wind-42"],
    ["Alpha__BETA---99", "alpha-beta-99"],
    ["Release\tCandidate 7", "release-candidate-7"]
  ];
  for (const [input, expected] of cases) {
    let actual;
    try {
      actual = normalizeProjectCode(input);
    } catch (err) {
      failures.push(`normalizeProjectCode(${JSON.stringify(input)}) threw ${err}`);
      continue;
    }
    if (actual !== expected) {
      failures.push(
        `normalizeProjectCode(${JSON.stringify(input)}) returned ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
      );
    }
  }
  try {
    normalizeProjectCode("!!!");
    failures.push('normalizeProjectCode("!!!") did not throw');
  } catch (err) {
    if (!(err instanceof TypeError)) {
      failures.push('normalizeProjectCode("!!!") threw a non-TypeError');
    } else if (err.message !== "project code requires letters or digits") {
      failures.push(
        `normalizeProjectCode("!!!") threw ${JSON.stringify(err.message)}, expected empty-code message`
      );
    }
  }
  return failures;
}

const requiredTestNeedles = [
  "KOTA_FULL_CYCLE_VERIFICATION",
  "North_Wind / 42",
  "Alpha__BETA---99",
  "!!!"
];

function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function verificationCoverage() {
  const testPath = join(process.cwd(), "test", "project-code.test.mjs");
  const text = readText(testPath);
  if (text === null) return { count: 0, failures: ["missing test/project-code.test.mjs"] };
  const failures = [];
  let count = 0;
  for (const needle of requiredTestNeedles) {
    if (text.includes(needle)) {
      count += 1;
    } else {
      failures.push(`test/project-code.test.mjs missing ${JSON.stringify(needle)}`);
    }
  }
  return { count, failures };
}

function packageFailures() {
  const packagePath = join(process.cwd(), "package.json");
  const raw = readText(packagePath);
  if (raw === null) return ["missing package.json"];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return [`package.json is not valid JSON: ${err}`];
  }
  if (parsed?.scripts?.test !== "node --test test/project-code.test.mjs") {
    return [
      'package.json scripts.test must be exactly "node --test test/project-code.test.mjs"'
    ];
  }
  if (parsed.type !== "module") {
    return ['package.json type must be "module"'];
  }
  return [];
}

const behavior = behaviorFailures();
const coverage = verificationCoverage();
const setup = packageFailures();

if (args.has("--metric-only")) {
  console.log(String(coverage.count));
  process.exit(0);
}

const requireTests = args.has("--require-tests");
const failures = [
  ...behavior,
  ...(requireTests ? coverage.failures : []),
  ...(requireTests ? setup : [])
];

const report = {
  behaviorFailures: behavior.length,
  verificationCases: coverage.count,
  setupFailures: setup.length,
  failures
};

console.log(JSON.stringify(report, null, 2));

const maxBehaviorFailures = optionNumber("--max-behavior-failures");
if (maxBehaviorFailures !== null && behavior.length > maxBehaviorFailures) {
  process.exit(1);
}

const maxFailures = optionNumber("--max-failures");
if (maxFailures !== null && failures.length > maxFailures) {
  process.exit(1);
}
