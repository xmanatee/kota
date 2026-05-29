#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifestPath = "test/targeted-tests.json";
const targetTestFile = "test/pricing.test.mjs";
const evidencePath = "artifacts/test-writing-evidence.json";
const sourcePath = "src/cart-pricing.mjs";
const existingTestNames = ["prices standard small carts with paid delivery"];
const requiredTestNames = [
  "applies the gold loyalty discount at the threshold subtotal",
  "does not give loyalty discount to silver customers",
  "keeps free delivery based on subtotal before discounts",
];
const allowedChangedPaths = new Set([
  "artifacts/test-writing-evidence.json",
  "test/pricing.test.mjs",
  "test/targeted-tests.json",
  "data/tasks/ready/task-cover-cart-pricing-rules.md",
  "data/tasks/done/task-cover-cart-pricing-rules.md",
]);
const mutations = [
  {
    id: "gold-threshold-exclusive",
    description: "Gold loyalty discount starts above the threshold instead of at it.",
    search: "order.customer.tier === \"gold\" && subtotalCents >= 5000",
    replacement: "order.customer.tier === \"gold\" && subtotalCents > 5000",
  },
  {
    id: "silver-discount-leak",
    description: "Non-bronze customers incorrectly receive the gold loyalty discount.",
    search: "order.customer.tier === \"gold\" && subtotalCents >= 5000",
    replacement: "order.customer.tier !== \"bronze\" && subtotalCents >= 5000",
  },
  {
    id: "delivery-after-discount",
    description: "Free delivery is calculated after the loyalty discount.",
    search: "const deliveryFeeCents = subtotalCents >= 7500 ? 0 : 799;",
    replacement:
      "const deliveryFeeCents = subtotalCents - loyaltyDiscountCents >= 7500 ? 0 : 799;",
  },
];

class CheckError extends Error {
  constructor(message) {
    super(message);
    this.name = "CheckError";
  }
}

function fail(message) {
  throw new CheckError(message);
}

function relativePath(path) {
  return relative(projectRoot, path).replaceAll("\\", "/");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${relativePath(path)} is not valid JSON: ${error.message}`);
  }
}

function ensurePlainObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be a JSON object`);
  }
  return value;
}

function validateManifestObject(manifest) {
  ensurePlainObject(manifest, "targeted test manifest");
  if (manifest.schemaVersion !== 1) {
    fail(`targeted test manifest schemaVersion must be 1`);
  }
  if (!Array.isArray(manifest.tests)) {
    fail(`targeted test manifest tests must be an array`);
  }
  if (manifest.tests.length !== requiredTestNames.length) {
    fail(
      `targeted test manifest must list exactly ${requiredTestNames.length} tests; got ${manifest.tests.length}`,
    );
  }

  const expected = new Set(requiredTestNames);
  const seen = new Set();
  for (const entry of manifest.tests) {
    ensurePlainObject(entry, "targeted test manifest entry");
    const unknownKeys = Object.keys(entry).filter((key) => key !== "file" && key !== "name");
    if (unknownKeys.length > 0) {
      fail(`targeted test manifest entry has unknown field(s): ${unknownKeys.join(", ")}`);
    }
    if (entry.file !== targetTestFile) {
      fail(`targeted tests must extend existing ${targetTestFile}, got ${JSON.stringify(entry.file)}`);
    }
    if (!expected.has(entry.name)) {
      fail(`targeted test manifest includes unrelated test name: ${JSON.stringify(entry.name)}`);
    }
    if (seen.has(entry.name)) {
      fail(`targeted test manifest duplicates test name: ${entry.name}`);
    }
    seen.add(entry.name);
  }
  for (const name of requiredTestNames) {
    if (!seen.has(name)) {
      fail(`targeted test manifest missing required test name: ${name}`);
    }
  }
  return manifest.tests;
}

function readManifest(root) {
  const absolute = join(root, manifestPath);
  if (!existsSync(absolute)) {
    fail(`missing targeted test manifest: ${manifestPath}`);
  }
  return validateManifestObject(readJson(absolute));
}

function walkFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(full));
      continue;
    }
    if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function extractTestNames(testFile) {
  const text = readFileSync(testFile, "utf8");
  const names = [];
  const pattern = /\btest\(\s*["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    names.push(match[1]);
  }
  return names;
}

function validatePlacementAndNames(root, manifestEntries) {
  const testDir = join(root, "test");
  if (!existsSync(testDir) || !statSync(testDir).isDirectory()) {
    fail("test directory missing");
  }
  const testFiles = walkFiles(testDir)
    .map((file) => relative(root, file).replaceAll("\\", "/"))
    .filter((file) => file.endsWith(".test.mjs"));
  if (testFiles.length !== 1 || testFiles[0] !== targetTestFile) {
    fail(`targeted tests must stay in existing ${targetTestFile}; found ${testFiles.join(", ")}`);
  }

  const manifestNames = new Set(manifestEntries.map((entry) => entry.name));
  const observedNames = extractTestNames(join(root, targetTestFile));
  const allowedNames = new Set([...existingTestNames, ...requiredTestNames]);
  for (const name of requiredTestNames) {
    if (!observedNames.includes(name)) {
      fail(`missing required test implementation: ${name}`);
    }
    if (!manifestNames.has(name)) {
      fail(`manifest missing implemented test: ${name}`);
    }
  }
  for (const name of observedNames) {
    if (!allowedNames.has(name)) {
      fail(`unexpected broad or unrelated test name in ${targetTestFile}: ${name}`);
    }
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runTargetedTests(root) {
  const pattern = `^(${requiredTestNames.map(escapeRegex).join("|")})$`;
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-name-pattern", pattern, targetTestFile],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    },
  );
  return {
    command: `node --test --test-name-pattern ${JSON.stringify(pattern)} ${targetTestFile}`,
    status: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error?.message,
  };
}

function tail(value) {
  return value.length > 1600 ? value.slice(-1600) : value;
}

function summarizeRun(result) {
  return {
    command: result.command,
    status: result.status,
    signal: result.signal,
    stdoutTail: tail(result.stdout),
    stderrTail: tail(result.stderr),
    ...(result.error !== undefined && { error: result.error }),
  };
}

function validateChangedPaths(paths) {
  const offenders = paths.filter(
    (path) => !path.startsWith(".kota/") && !allowedChangedPaths.has(path),
  );
  if (offenders.length > 0) {
    fail(`changed path(s) outside accepted test/task evidence set: ${offenders.join(", ")}`);
  }
}

function writeEvidence(evidence) {
  const absolute = join(projectRoot, evidencePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, JSON.stringify(evidence, null, 2) + "\n");
}

function runMainCheck({ metricOnly }) {
  rmSync(join(projectRoot, evidencePath), { force: true });
  const manifestEntries = readManifest(projectRoot);
  validatePlacementAndNames(projectRoot, manifestEntries);

  const baseline = runTargetedTests(projectRoot);
  if (baseline.status !== 0 || baseline.error !== undefined) {
    writeEvidence({
      schemaVersion: 1,
      status: "failed",
      reason: "baseline-targeted-tests-failed",
      tests: requiredTestNames,
      baseline: summarizeRun(baseline),
      mutations: [],
      mutationsCaught: 0,
    });
    fail(`targeted tests must pass on the unmutated baseline`);
  }

  const absoluteSource = join(projectRoot, sourcePath);
  const originalSource = readFileSync(absoluteSource, "utf8");
  const mutationResults = [];
  try {
    for (const mutation of mutations) {
      if (!originalSource.includes(mutation.search)) {
        fail(`mutation ${mutation.id} could not find its source pattern`);
      }
      writeFileSync(
        absoluteSource,
        originalSource.replace(mutation.search, mutation.replacement),
        "utf8",
      );
      const result = runTargetedTests(projectRoot);
      mutationResults.push({
        id: mutation.id,
        description: mutation.description,
        caught: result.status !== 0,
        run: summarizeRun(result),
      });
    }
  } finally {
    writeFileSync(absoluteSource, originalSource, "utf8");
  }

  const mutationsCaught = mutationResults.filter((result) => result.caught).length;
  const evidence = {
    schemaVersion: 1,
    status: mutationsCaught === mutations.length ? "passed" : "failed",
    manifestPath,
    targetTestFile,
    tests: requiredTestNames,
    baseline: summarizeRun(baseline),
    mutations: mutationResults,
    mutationsCaught,
    mutationCount: mutations.length,
  };
  writeEvidence(evidence);

  if (mutationsCaught !== mutations.length) {
    const missed = mutationResults
      .filter((result) => !result.caught)
      .map((result) => result.id)
      .join(", ");
    fail(`targeted tests did not catch deterministic mutation(s): ${missed}`);
  }

  if (metricOnly) {
    console.log(mutationsCaught);
  } else {
    console.log(
      JSON.stringify(
        {
          status: "ok",
          targeted_tests: requiredTestNames.length,
          mutations_caught: mutationsCaught,
          evidence: evidencePath,
        },
        null,
        2,
      ),
    );
  }
}

function expectShortcutFailure(name, fn, expectedMessage) {
  try {
    fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(expectedMessage)) {
      throw new CheckError(
        `${name} failed for the wrong reason. Expected ${JSON.stringify(expectedMessage)} in ${JSON.stringify(message)}`,
      );
    }
    return;
  }
  throw new CheckError(`${name} shortcut unexpectedly passed`);
}

function runShortcutSelfTest() {
  expectShortcutFailure(
    "product-code-edit",
    () => validateChangedPaths(["src/cart-pricing.mjs"]),
    "outside accepted test/task evidence set",
  );
  expectShortcutFailure(
    "unrelated-tests",
    () =>
      validateManifestObject({
        schemaVersion: 1,
        tests: [{ file: targetTestFile, name: "covers many cart pricing examples" }],
      }),
    "exactly",
  );
  expectShortcutFailure(
    "wrong-test-bucket",
    () =>
      validateManifestObject({
        schemaVersion: 1,
        tests: requiredTestNames.map((name) => ({
          file: "test/cart-pricing.test.mjs",
          name,
        })),
      }),
    `existing ${targetTestFile}`,
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        shortcutGuards: [
          "product-code-edit",
          "unrelated-tests",
          "wrong-test-bucket",
        ],
      },
      null,
      2,
    ),
  );
}

const args = process.argv.slice(2);
try {
  if (args.includes("--self-test-shortcuts")) {
    runShortcutSelfTest();
  } else {
    runMainCheck({
      metricOnly: args.includes("--metric-only"),
    });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
