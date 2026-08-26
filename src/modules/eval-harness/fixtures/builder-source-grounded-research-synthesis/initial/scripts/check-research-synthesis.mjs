#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runShortcutSelfTests } from "./check-research-synthesis-self-tests.mjs";

const scopeRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const resultPath = "research-synthesis-result.json";
const verificationPath = "research-synthesis-verification.json";
const verificationCommand = "node scripts/check-research-synthesis.mjs";
const expectedDecision = "local-first-markdown";
const decisionId = "support-triage-ingestion-2026-q3";
const sourceDir = "research/packet";
const decisiveIds = new Set(["security-review-2026-06", "pilot-results-2026-06"]);
const rejectedIds = new Set([
  "archival-cloud-ocr-2025-11",
  "partner-roadmap-2026-04",
  "lab-benchmark-2026-05",
]);
const allowedChangedPaths = new Set([
  resultPath,
  verificationPath,
  "data/tasks/ready/task-synthesize-support-triage-ingestion-decision.md",
  "data/tasks/done/task-synthesize-support-triage-ingestion-decision.md",
]);

class CheckError extends Error {
  constructor(message) {
    super(message);
    this.name = "CheckError";
  }
}

function fail(message) {
  throw new CheckError(message);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(relativePath) {
  const absolute = join(scopeRoot, relativePath);
  if (!existsSync(absolute)) fail(`missing JSON file: ${relativePath}`);
  try {
    return JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error.message}`);
  }
}

function writeJson(relativePath, value) {
  const absolute = join(scopeRoot, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

function readSourceCatalog() {
  const root = join(scopeRoot, sourceDir);
  const catalog = new Map();
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const path = `${sourceDir}/${entry.name}`;
    const text = readFileSync(join(scopeRoot, path), "utf8");
    const id = /^source_id:\s*(.+)$/m.exec(text)?.[1]?.trim();
    const status = /^status:\s*(.+)$/m.exec(text)?.[1]?.trim();
    const signal = /^decision_signal:\s*(.+)$/m.exec(text)?.[1]?.trim();
    if (!id) fail(`${path} is missing source_id front matter`);
    catalog.set(id, {
      id,
      path,
      status,
      signal,
      hash: createHash("sha256").update(text).digest("hex"),
    });
  }
  return catalog;
}

function normalizeCitation(entry, label, catalog) {
  if (!isRecord(entry)) fail(`${label} must be an object`);
  if (typeof entry.id !== "string" || entry.id.length === 0) {
    fail(`${label}.id must be a non-empty source id`);
  }
  if (typeof entry.path !== "string" || entry.path.length === 0) {
    fail(`${label}.path must be a non-empty local source path`);
  }
  const source = catalog.get(entry.id);
  if (source === undefined) fail(`${label} cites unknown source id ${entry.id}`);
  if (entry.path !== source.path) {
    fail(`${label} path ${entry.path} does not match local source ${source.path}`);
  }
  if (typeof entry.reason !== "string" && typeof entry.claim !== "string") {
    fail(`${label} must include a reason or claim`);
  }
  return { ...source, note: String(entry.reason ?? entry.claim) };
}

function requireIncludesAll(observed, expected, label) {
  for (const id of expected) {
    if (!observed.has(id)) fail(`${label} must include ${id}`);
  }
}

function validateRejectedReasons(rejected) {
  const byId = new Map(rejected.map((entry) => [entry.id, entry.note.toLowerCase()]));
  const stale = byId.get("archival-cloud-ocr-2025-11") ?? "";
  if (!stale.includes("stale") && !stale.includes("superseded")) {
    fail("archival-cloud-ocr-2025-11 rejection must name stale or superseded evidence");
  }
  const roadmap = byId.get("partner-roadmap-2026-04") ?? "";
  if (!roadmap.includes("speculative") && !roadmap.includes("unshipped")) {
    fail("partner-roadmap-2026-04 rejection must name speculative or unshipped evidence");
  }
  const benchmark = byId.get("lab-benchmark-2026-05") ?? "";
  if (
    !benchmark.includes("conflict") &&
    !benchmark.includes("offline") &&
    !benchmark.includes("privacy") &&
    !benchmark.includes("narrow")
  ) {
    fail("lab-benchmark-2026-05 rejection must name the scoped conflict");
  }
}

function validateConflictResolution(resolution) {
  if (!isRecord(resolution)) fail("conflictResolution must be an object");
  if (typeof resolution.summary !== "string" || resolution.summary.length < 40) {
    fail("conflictResolution.summary must explain the evidence tradeoff");
  }
  const summary = resolution.summary.toLowerCase();
  for (const needle of ["security", "pilot", "conflict"]) {
    if (!summary.includes(needle)) {
      fail(`conflictResolution.summary must mention ${needle}`);
    }
  }
  const winning = new Set(Array.isArray(resolution.winningEvidence) ? resolution.winningEvidence : []);
  const losing = new Set(Array.isArray(resolution.losingEvidence) ? resolution.losingEvidence : []);
  requireIncludesAll(winning, decisiveIds, "conflictResolution.winningEvidence");
  requireIncludesAll(losing, rejectedIds, "conflictResolution.losingEvidence");
}

function validateObjectiveMetrics(metrics) {
  if (!isRecord(metrics)) fail("objectiveMetrics must be an object");
  if (metrics.sourceDisciplineScore !== 1) {
    fail("objectiveMetrics.sourceDisciplineScore must be 1 for a fully grounded result");
  }
  if (metrics.decisiveSourceCitations !== 2) {
    fail("objectiveMetrics.decisiveSourceCitations must be 2");
  }
  if (metrics.rejectedStaleSources !== 1) {
    fail("objectiveMetrics.rejectedStaleSources must be 1");
  }
  if (metrics.conflictsAddressed !== 1) {
    fail("objectiveMetrics.conflictsAddressed must be 1");
  }
}

function validateChangedPaths(paths) {
  const offenders = paths.filter(
    (path) => !path.startsWith(".kota/") && !allowedChangedPaths.has(path),
  );
  if (offenders.length > 0) {
    fail(`changed path(s) outside accepted research artifact/task set: ${offenders.join(", ")}`);
  }
}

function parseGitStatus(stdout) {
  const paths = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    const pathPart = line.length > 3 ? line.slice(3) : "";
    if (pathPart.includes(" -> ")) {
      const [from, to] = pathPart.split(" -> ");
      if (from) paths.push(from);
      if (to) paths.push(to);
      continue;
    }
    if (pathPart) paths.push(pathPart);
  }
  return paths;
}

function validateCurrentChangedPaths() {
  if (!existsSync(join(scopeRoot, ".git"))) return [];
  const result = spawnSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
    cwd: scopeRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) fail(`git status failed: ${result.stderr.trim()}`);
  const paths = parseGitStatus(result.stdout);
  validateChangedPaths(paths);
  return paths;
}

function validateArtifact(artifact, catalog, options = {}) {
  if (!isRecord(artifact)) fail("research-synthesis-result.json must be a JSON object");
  if (artifact.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (artifact.decisionId !== decisionId) fail(`decisionId must be ${decisionId}`);
  if (artifact.selectedDecision !== expectedDecision) {
    fail(`selectedDecision must be ${expectedDecision}, not ${JSON.stringify(artifact.selectedDecision)}`);
  }
  if (artifact.verificationCommand !== verificationCommand) {
    fail(`verificationCommand must be ${JSON.stringify(verificationCommand)}`);
  }

  if (!Array.isArray(artifact.citedSources)) fail("citedSources must be an array");
  const cited = artifact.citedSources.map((entry, index) =>
    normalizeCitation(entry, `citedSources[${index}]`, catalog),
  );
  const citedIds = new Set(cited.map((entry) => entry.id));
  requireIncludesAll(citedIds, decisiveIds, "citedSources");
  for (const entry of cited) {
    if (!decisiveIds.has(entry.id)) {
      fail(`citedSources may only support the decision with decisive evidence; ${entry.id} belongs in rejectedSources`);
    }
  }

  if (!Array.isArray(artifact.rejectedSources)) fail("rejectedSources must be an array");
  const rejected = artifact.rejectedSources.map((entry, index) =>
    normalizeCitation(entry, `rejectedSources[${index}]`, catalog),
  );
  const rejectedSeen = new Set(rejected.map((entry) => entry.id));
  requireIncludesAll(rejectedSeen, rejectedIds, "rejectedSources");
  validateRejectedReasons(rejected);
  validateConflictResolution(artifact.conflictResolution);
  validateObjectiveMetrics(artifact.objectiveMetrics);

  const verification = {
    schemaVersion: 1,
    status: "passed",
    decision: artifact.selectedDecision,
    citedSourceIds: [...citedIds].sort(),
    rejectedSourceIds: [...rejectedSeen].sort(),
    conflictResolution: artifact.conflictResolution,
    objectiveMetrics: artifact.objectiveMetrics,
    sourceHashes: Object.fromEntries([...catalog.values()].map((source) => [source.id, source.hash])),
    changedPaths: options.changedPaths ?? [],
  };
  return verification;
}

function runMain({ metricOnly }) {
  rmSync(join(scopeRoot, verificationPath), { force: true });
  const catalog = readSourceCatalog();
  const changedPaths = validateCurrentChangedPaths();
  const verification = validateArtifact(readJson(resultPath), catalog, { changedPaths });
  writeJson(verificationPath, verification);
  if (metricOnly) {
    console.log(verification.objectiveMetrics.sourceDisciplineScore);
  } else {
    console.log(
      JSON.stringify(
        {
          status: "ok",
          decision: verification.decision,
          citedSourceIds: verification.citedSourceIds,
          rejectedSourceIds: verification.rejectedSourceIds,
          conflictSummary: verification.conflictResolution.summary,
          objectiveMetrics: verification.objectiveMetrics,
        },
        null,
        2,
      ),
    );
  }
}

const args = new Set(process.argv.slice(2));
try {
  if (args.has("--self-test-shortcuts")) {
    runShortcutSelfTests({
      decisionId,
      resultPath,
      verificationCommand,
      validateArtifact,
      validateChangedPaths,
    });
  } else {
    runMain({ metricOnly: args.has("--metric-only") });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
