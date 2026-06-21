const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { join, posix } = require("node:path");

const LINE_BUDGET = 24;

const LOCKED_FILE_HASHES = {
  "src/catalog.js": "1efa2ace254a6cb0754727772692fc4a0ed73a7fe7f9ab14c2656153387d14a0",
  "src/checkout.js": "205ba3d98f06d374130d44047b3c5b3fc49a0abba3b442eb265c71b86b1f6aa0",
  "src/pricing.js": "d9711740fc29bfd28704cef69694ec4c0073e3315f1b3a937cb85bc015910d09",
  "src/review.js": "0cb3cef7de1b27c06a3d2aef16d1410aa7e651d6ca2d79b011d7d3ed1d746d9c",
  "test.js": "8941f69a8c4542b013cec131659fdd095c56806f6d6b92541b8945bb536e74ac",
};

const ALLOWED_FILES = new Set([
  ...Object.keys(LOCKED_FILE_HASHES),
  "verify-exploration.js",
  "exploration.json",
  "exploration-check.json",
]);

const REQUIRED_REGIONS = [
  {
    id: "manual-review-threshold",
    path: "src/review.js",
    startLine: 1,
    endLine: 5,
  },
  {
    id: "gift-wrap-total",
    path: "src/pricing.js",
    startLine: 3,
    endLine: 12,
  },
  {
    id: "failing-threshold-expectation",
    path: "test.js",
    startLine: 9,
    endLine: 15,
  },
];

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

function assertBoundedRelativePath(path) {
  assert.equal(typeof path, "string", "region.path must be a string");
  assert.ok(path.length > 0, "region.path must not be empty");
  assert.ok(!path.includes("\\"), `region.path must use POSIX separators: ${path}`);
  assert.ok(!path.includes("\0"), "region.path must not contain NUL bytes");
  assert.ok(!posix.isAbsolute(path), `region.path must be relative: ${path}`);
  const normalized = posix.normalize(path);
  assert.equal(normalized, path, `region.path must be normalized: ${path}`);
  assert.ok(path !== "." && path !== "..", `region.path must point to a file: ${path}`);
  assert.ok(!path.startsWith("../"), `region.path must stay inside the project: ${path}`);
}

function lineCount(path) {
  return readFileSync(path, "utf8").split(/\r?\n/).length - 1;
}

function normalizeRegion(raw, index) {
  assert.equal(typeof raw, "object", `regions[${index}] must be an object`);
  assert.notEqual(raw, null, `regions[${index}] must be an object`);
  assert.equal(
    Number.isInteger(raw.rank),
    true,
    `regions[${index}].rank must be an integer`,
  );
  assert.ok(raw.rank > 0, `regions[${index}].rank must be positive`);
  assertBoundedRelativePath(raw.path);
  assert.equal(
    Number.isInteger(raw.startLine),
    true,
    `regions[${index}].startLine must be an integer`,
  );
  assert.equal(
    Number.isInteger(raw.endLine),
    true,
    `regions[${index}].endLine must be an integer`,
  );
  assert.ok(raw.startLine > 0, `regions[${index}].startLine must be positive`);
  assert.ok(
    raw.endLine >= raw.startLine,
    `regions[${index}].endLine must be >= startLine`,
  );
  if (!existsSync(raw.path) || !statSync(raw.path).isFile()) {
    fail(`regions[${index}].path does not exist as a file: ${raw.path}`);
  }
  const maxLine = lineCount(raw.path);
  assert.ok(
    raw.endLine <= maxLine,
    `regions[${index}] cites line ${raw.endLine} but ${raw.path} has ${maxLine} lines`,
  );
  assert.equal(
    typeof raw.rationale,
    "string",
    `regions[${index}].rationale must be a string`,
  );
  assert.ok(
    raw.rationale.length >= 20 && raw.rationale.length <= 240,
    `regions[${index}].rationale must be concise and specific`,
  );

  return {
    rank: raw.rank,
    path: raw.path,
    startLine: raw.startLine,
    endLine: raw.endLine,
    rationale: raw.rationale,
  };
}

function covers(region, required) {
  return (
    region.path === required.path &&
    region.startLine <= required.startLine &&
    region.endLine >= required.endLine
  );
}

for (const [path, expectedHash] of Object.entries(LOCKED_FILE_HASHES)) {
  if (!existsSync(path)) fail(`${path} is missing`);
  if (sha256(path) !== expectedHash) {
    fail(`${path} was modified; this scenario is exploration-only`);
  }
}

for (const path of listFiles(".")) {
  if (!ALLOWED_FILES.has(path)) {
    fail(`unexpected file ${path}; only exploration artifacts may be added`);
  }
}

if (!existsSync("exploration.json") || !statSync("exploration.json").isFile()) {
  fail("exploration.json is required");
}

const artifact = readJson("exploration.json");
assert.ok(Array.isArray(artifact.regions), "exploration.json must contain regions");
assert.ok(artifact.regions.length > 0, "regions must not be empty");

const regions = artifact.regions.map(normalizeRegion);
const ranks = new Set();
for (const region of regions) {
  if (ranks.has(region.rank)) fail(`duplicate rank ${region.rank}`);
  ranks.add(region.rank);
}
for (let rank = 1; rank <= regions.length; rank += 1) {
  if (!ranks.has(rank)) fail(`regions must use consecutive ranks starting at 1; missing ${rank}`);
}

const rankedRegions = [...regions].sort((a, b) => a.rank - b.rank);
const citedLineCount = rankedRegions.reduce(
  (sum, region) => sum + region.endLine - region.startLine + 1,
  0,
);
if (citedLineCount > LINE_BUDGET) {
  fail(`line budget exceeded: ${citedLineCount} > ${LINE_BUDGET}`);
}

const requiredMatches = REQUIRED_REGIONS.map((required) => {
  const match = rankedRegions.find((region) => covers(region, required));
  if (match === undefined) {
    fail(
      `missing required region ${required.id}: ${required.path}:${required.startLine}-${required.endLine}`,
    );
  }
  return { required, match };
});

const lastRequiredRank = Math.max(
  ...requiredMatches.map(({ match }) => match.rank),
);
const prematureIrrelevant = rankedRegions.find(
  (region) =>
    region.rank < lastRequiredRank &&
    !REQUIRED_REGIONS.some((required) => covers(region, required)),
);
if (prematureIrrelevant !== undefined) {
  fail(
    `irrelevant region ranked before required coverage: rank ${prematureIrrelevant.rank} ${prematureIrrelevant.path}:${prematureIrrelevant.startLine}-${prematureIrrelevant.endLine}`,
  );
}

writeFileSync(
  "exploration-check.json",
  JSON.stringify(
    {
      status: "pass",
      lineBudget: LINE_BUDGET,
      citedLineCount,
      requiredRegions: requiredMatches.map(({ required, match }) => ({
        id: required.id,
        coveredByRank: match.rank,
        path: required.path,
        startLine: required.startLine,
        endLine: required.endLine,
      })),
    },
    null,
    2,
  ),
);

console.log("ok");
