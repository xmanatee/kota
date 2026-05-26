import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === "--metric-only") {
    args.set("metric-only", true);
    continue;
  }
  if (arg === "--max-mismatches") {
    const value = Number(process.argv[i + 1]);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("--max-mismatches requires a non-negative integer");
    }
    args.set("max-mismatches", value);
    i += 1;
    continue;
  }
  throw new Error(`Unknown argument: ${arg}`);
}

const root = process.cwd();
const candidatePath = join(root, "src", "badge-code.mjs");
const referencePath = join(root, "oracle", "run-reference.mjs");
const oracleArtifactPath = join(root, "oracle", "reference.wasm.base64");
const oracleArtifactBase64 = readFileSync(oracleArtifactPath, "utf8").trim();
const bannedSourcePatterns = [
  /\boracle\b/i,
  /\breference\b/i,
  /\bwasm\b/i,
  /\bWebAssembly\b/,
  /\bchild_process\b/,
  /\bspawn(?:Sync)?\b/,
  /\bexec(?:File|Sync)?\b/,
  /\breadFile(?:Sync)?\b/,
  /\bcreateRequire\b/,
  /\bimport\s*\(/,
];

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function compactBase64(text) {
  return text.replace(/[^A-Za-z0-9+/=]/g, "");
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
      continue;
    }
    out.push(full);
  }
  return out;
}

function shortcutIssues() {
  const issues = [];
  if (!existsSync(candidatePath)) {
    return ["missing src/badge-code.mjs"];
  }
  const oracleHash = hashFile(oracleArtifactPath);
  for (const file of listFiles(join(root, "src"))) {
    const rel = relative(root, file);
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) {
      issues.push(`${rel} is a symlink`);
      continue;
    }
    if (/\.(?:wasm|base64)$/i.test(file)) {
      issues.push(`${rel} copies an oracle-style artifact`);
      continue;
    }
    if (hashFile(file) === oracleHash) {
      issues.push(`${rel} exactly matches the oracle artifact`);
      continue;
    }
    const text = readFileSync(file, "utf8");
    if (
      text.includes(oracleArtifactBase64) ||
      compactBase64(text).includes(oracleArtifactBase64)
    ) {
      issues.push(`${rel} embeds the oracle artifact`);
    }
    for (const pattern of bannedSourcePatterns) {
      if (pattern.test(text)) {
        issues.push(`${rel} contains forbidden shortcut token ${pattern}`);
      }
    }
  }
  return issues;
}

function fixedCases() {
  return [
    { name: "help", args: ["--help"] },
    { name: "basic spaced label", args: ["Alpha 7"] },
    { name: "separator collapse", args: ["  north__gate  "] },
    { name: "mixed case digits", args: ["MIXED_case-42"] },
    { name: "short edge", args: ["Z9"] },
    { name: "invalid punctuation", args: ["bad!label"] },
    { name: "too long after normalization", args: ["abcdefghijklmnopqrstuvwxy"] },
  ];
}

function generatedCases() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const separators = [" ", "_", "-", "__", " - "];
  let seed = 918273;
  function next() {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  }
  const cases = [];
  for (let i = 0; i < 24; i += 1) {
    const parts = [];
    const partCount = 2 + (next() % 3);
    for (let part = 0; part < partCount; part += 1) {
      const len = 1 + (next() % 5);
      let text = "";
      for (let j = 0; j < len; j += 1) {
        const value = next();
        text += value % 5 === 0
          ? String(value % 10)
          : alphabet[value % alphabet.length];
      }
      parts.push(text);
    }
    const label = parts.join(separators[next() % separators.length]);
    cases.push({ name: `generated-${i}`, args: [i % 4 === 0 ? ` ${label} ` : label] });
  }
  cases.push({ name: "generated separator edge", args: ["___edge--case  9___"] });
  return cases;
}

function runNode(script, argv, forbidReference) {
  const result = spawnSync(process.execPath, [script, ...argv], {
    cwd: root,
    encoding: "utf8",
    timeout: 5000,
    env: {
      ...process.env,
      ...(forbidReference ? { KOTA_BLACK_BOX_REFERENCE_FORBIDDEN: "1" } : {}),
    },
  });
  const timedOut = result.signal === "SIGTERM" || result.error?.message.includes("ETIMEDOUT");
  return {
    status: timedOut ? "timeout" : result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

const cases = [...fixedCases(), ...generatedCases()];
const mismatches = [];
for (const testCase of cases) {
  const expected = runNode(referencePath, testCase.args, false);
  const actual = runNode(candidatePath, testCase.args, true);
  if (
    expected.status !== actual.status ||
    expected.stdout !== actual.stdout ||
    expected.stderr !== actual.stderr
  ) {
    mismatches.push({
      case: testCase.name,
      args: testCase.args,
      expected,
      actual,
    });
  }
}

const shortcutGuard = shortcutIssues();
const totalFailures = mismatches.length + shortcutGuard.length;

if (args.get("metric-only") === true) {
  console.log(String(totalFailures));
  process.exit(0);
}

const report = {
  fixed_cases: fixedCases().length,
  generated_cases: generatedCases().length,
  total_cases: cases.length,
  matched_cases: cases.length - mismatches.length,
  mismatches,
  shortcut_guard: shortcutGuard,
  behavior_mismatches: totalFailures,
};
console.log(JSON.stringify(report, null, 2));

const threshold = args.get("max-mismatches");
if (threshold !== undefined && totalFailures > threshold) {
  console.error(`behavior_mismatches=${totalFailures} exceeds max ${threshold}`);
  process.exit(1);
}
