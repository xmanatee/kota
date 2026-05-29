const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} = require("node:fs");
const { join } = require("node:path");

const LOCKED_FILE_HASHES = {
  "src/catalog.js": "00cefef01d7dbd206a205f3e7a3a273977b4c87331792d073183a7d1363b83fd",
  "src/checkout.js": "2e44e24559e9fdc7d37860afd4e2a83baaf00493ace0c7e497084fe16803e257",
  "src/regions.js": "2347634e4bede9796c2a3027bf0412cd4c704b14aeeb13b908ac4f340339d820",
  "reproduce.js": "9468466f387194613a045832d6ffdbf2825ba88013cfaa7b6c8e22cc66e31c32",
  "test.js": "2a5c33a3130b3cb0664426eb260af9d97d076cfb94e02d670521f15bd831c99a",
};

const ALLOWED_FILES = new Set([
  ...Object.keys(LOCKED_FILE_HASHES),
  "verify-answer.js",
  "answer.json",
  "runtime-evidence.txt",
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function listFiles(dir, prefix = "") {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFiles(join(dir, entry.name), rel));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files.sort();
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    fail(`${path} must contain valid JSON: ${err.message}`);
  }
}

function citationPaths(citations) {
  assert.ok(Array.isArray(citations), "sourceCitations must be an array");
  return citations.map((citation) => {
    assert.equal(typeof citation, "object");
    assert.notEqual(citation, null);
    assert.equal(typeof citation.path, "string");
    assert.equal(typeof citation.reason, "string");
    return citation.path;
  });
}

function runtimeCitationLines(citations) {
  assert.ok(Array.isArray(citations), "runtimeCitations must be an array");
  return citations.flatMap((citation) => {
    assert.equal(typeof citation, "object");
    assert.notEqual(citation, null);
    assert.equal(citation.path, "runtime-evidence.txt");
    assert.equal(citation.command, "node reproduce.js");
    assert.ok(Array.isArray(citation.lines), "runtime citation lines must be an array");
    return citation.lines;
  });
}

function requireTerms(text, terms, label) {
  const lower = text.toLowerCase();
  for (const term of terms) {
    assert.ok(
      lower.includes(term.toLowerCase()),
      `${label} must mention ${term}`,
    );
  }
}

function requireFinding(answer, id, expected) {
  const finding = answer.findings.find((item) => item.id === id);
  assert.ok(finding, `missing finding ${id}`);
  assert.equal(typeof finding.statement, "string");
  requireTerms(finding.statement, expected.terms, `finding ${id}`);

  const sources = citationPaths(finding.sourceCitations);
  for (const path of expected.sourcePaths) {
    assert.ok(sources.includes(path), `finding ${id} must cite ${path}`);
  }

  const runtimeLines = runtimeCitationLines(finding.runtimeCitations);
  for (const line of expected.runtimeLines) {
    assert.ok(
      runtimeLines.includes(line),
      `finding ${id} must cite runtime line ${line}`,
    );
  }
}

for (const [path, expectedHash] of Object.entries(LOCKED_FILE_HASHES)) {
  if (!existsSync(path)) fail(`${path} is missing`);
  if (sha256(path) !== expectedHash) {
    fail(`${path} was modified; this scenario is answer-only`);
  }
}

for (const path of listFiles(".")) {
  if (!ALLOWED_FILES.has(path)) {
    fail(`unexpected file ${path}; only answer artifacts may be added`);
  }
}

if (!existsSync("answer.json") || !statSync("answer.json").isFile()) {
  fail("answer.json is required");
}
if (!existsSync("runtime-evidence.txt") || !statSync("runtime-evidence.txt").isFile()) {
  fail("runtime-evidence.txt is required");
}

const runtime = spawnSync("node", ["reproduce.js"], {
  cwd: process.cwd(),
  encoding: "utf8",
});
if (runtime.status !== 0) {
  fail(`node reproduce.js failed:\n${runtime.stderr || runtime.stdout}`);
}
const expectedRuntimeEvidence = runtime.stdout;
const runtimeEvidence = readFileSync("runtime-evidence.txt", "utf8");
assert.equal(
  runtimeEvidence,
  expectedRuntimeEvidence,
  "runtime-evidence.txt must contain exact stdout from node reproduce.js",
);

const requiredRuntimeLines = [
  "destination=GB",
  "regionAllowed=true",
  "baseMinor=4500",
  "giftWrapMinor=1000",
  "totalMinor=5500",
  "reviewThresholdMinor=5000",
  "decision=manual_review",
];
for (const line of requiredRuntimeLines) {
  assert.ok(runtimeEvidence.includes(`${line}\n`), `runtime evidence missing ${line}`);
}

const answer = readJson("answer.json");
assert.equal(typeof answer.summary, "string");
requireTerms(answer.summary, ["GB", "gift", "manual", "5500", "5000"], "summary");
assert.ok(Array.isArray(answer.findings), "findings must be an array");

requireFinding(answer, "gb-region-is-allowed", {
  terms: ["GB", "allowed"],
  sourcePaths: ["src/regions.js", "src/checkout.js"],
  runtimeLines: ["destination=GB", "regionAllowed=true"],
});
requireFinding(answer, "gift-wrap-raises-total", {
  terms: ["gift", "5500", "5000"],
  sourcePaths: ["src/catalog.js", "src/checkout.js"],
  runtimeLines: ["baseMinor=4500", "giftWrapMinor=1000", "totalMinor=5500"],
});
requireFinding(answer, "threshold-causes-manual-review", {
  terms: ["manual_review", "5000"],
  sourcePaths: ["src/checkout.js"],
  runtimeLines: ["reviewThresholdMinor=5000", "decision=manual_review"],
});

console.log("ok");
