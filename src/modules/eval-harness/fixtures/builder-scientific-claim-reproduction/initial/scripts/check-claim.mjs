import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const ANALYZER_PATH = "scripts/analyze-claim.mjs";
const MAIN_DATA_PATH = "data/claims/lx12-biomass.csv";
const MAIN_OUTPUT_PATH = "claim-result.json";
const CLAIM_ID = "claim-lx12-mature-week6-biomass";
const METRIC_NAME = "median_uplift_pct";
const THRESHOLD_PCT = 40;
const EXPECTED_FILTERS = {
  cohort: "mature",
  phase: "week6",
  site: "greenhouse-a",
  include_in_claim: "yes",
  quality_flag: "ok",
};
const MAIN_EXPECTED = {
  dataPath: MAIN_DATA_PATH,
  outputPath: MAIN_OUTPUT_PATH,
  verdict: "refuted",
  controlMedian: 10,
  treatmentMedian: 13,
  upliftPct: 30,
  rowIds: {
    control: ["C01", "C02", "C03", "C04", "C05"],
    lx12: ["T01", "T02", "T03", "T04", "T05"],
  },
};
const HOLDOUT_DATA_PATH = ".kota/claim-holdout.csv";
const HOLDOUT_OUTPUT_PATH = ".kota/claim-holdout-result.json";
const HOLDOUT_EXPECTED = {
  dataPath: HOLDOUT_DATA_PATH,
  outputPath: HOLDOUT_OUTPUT_PATH,
  verdict: "supported",
  controlMedian: 10,
  treatmentMedian: 16,
  upliftPct: 60,
  rowIds: {
    control: ["HC1", "HC2", "HC3"],
    lx12: ["HT1", "HT2", "HT3"],
  },
};

function parseArgs(argv) {
  const args = { maxErrorPct: 0.000001, metricOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--max-error-pct") {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error("--max-error-pct requires a non-negative number");
      }
      args.maxErrorPct = value;
    } else if (argv[i] === "--metric-only") {
      args.metricOnly = true;
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function approxEqual(actual, expected, tolerance) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

function numberAt(record, path) {
  const value = path.reduce(
    (current, key) => (isRecord(current) ? current[key] : undefined),
    record,
  );
  return typeof value === "number" ? value : Number.NaN;
}

function arraysEqual(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function validateArtifact(artifact, expected, tolerance, label) {
  const issues = [];
  if (!isRecord(artifact)) {
    return [`${label}: artifact is not a JSON object`];
  }
  if (artifact.schemaVersion !== 1) {
    issues.push(`${label}: schemaVersion must be 1`);
  }
  if (artifact.claimId !== CLAIM_ID) {
    issues.push(`${label}: claimId must be ${CLAIM_ID}`);
  }
  if (artifact.verdict !== expected.verdict) {
    issues.push(
      `${label}: verdict ${JSON.stringify(artifact.verdict)} is not ${expected.verdict}`,
    );
  }
  const metric = isRecord(artifact.metric) ? artifact.metric : {};
  if (metric.name !== METRIC_NAME) {
    issues.push(`${label}: metric.name must be ${METRIC_NAME}`);
  }
  const metricChecks = [
    ["metric.value", numberAt(artifact, ["metric", "value"]), expected.upliftPct],
    [
      "metric.control_median",
      numberAt(artifact, ["metric", "control_median"]),
      expected.controlMedian,
    ],
    [
      "metric.treatment_median",
      numberAt(artifact, ["metric", "treatment_median"]),
      expected.treatmentMedian,
    ],
    [
      "metric.threshold_pct",
      numberAt(artifact, ["metric", "threshold_pct"]),
      THRESHOLD_PCT,
    ],
  ];
  for (const [name, actual, expectedValue] of metricChecks) {
    if (!approxEqual(actual, expectedValue, tolerance)) {
      issues.push(
        `${label}: ${name} ${actual} differs from expected ${expectedValue}`,
      );
    }
  }

  const expectedCommand =
    `node scripts/analyze-claim.mjs --data ${expected.dataPath} --output ${expected.outputPath}`;
  if (artifact.command !== expectedCommand) {
    issues.push(`${label}: command must be ${JSON.stringify(expectedCommand)}`);
  }

  const provenance = isRecord(artifact.provenance) ? artifact.provenance : {};
  if (provenance.data !== expected.dataPath) {
    issues.push(`${label}: provenance.data must be ${expected.dataPath}`);
  }
  if (provenance.method !== "median") {
    issues.push(`${label}: provenance.method must be "median"`);
  }
  const filters = isRecord(provenance.filters) ? provenance.filters : {};
  for (const [key, value] of Object.entries(EXPECTED_FILTERS)) {
    if (filters[key] !== value) {
      issues.push(`${label}: provenance.filters.${key} must be ${value}`);
    }
  }
  const rowIds = isRecord(provenance.row_ids) ? provenance.row_ids : {};
  if (!arraysEqual(rowIds.control, expected.rowIds.control)) {
    issues.push(
      `${label}: provenance.row_ids.control must be ${expected.rowIds.control.join(",")}`,
    );
  }
  if (!arraysEqual(rowIds.lx12, expected.rowIds.lx12)) {
    issues.push(
      `${label}: provenance.row_ids.lx12 must be ${expected.rowIds.lx12.join(",")}`,
    );
  }
  return issues;
}

function runAnalyzer(dataPath, outputPath) {
  return spawnSync(
    process.execPath,
    [ANALYZER_PATH, "--data", dataPath, "--output", outputPath],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    },
  );
}

function ensureHoldoutData() {
  mkdirSync(dirname(HOLDOUT_DATA_PATH), { recursive: true });
  writeFileSync(
    HOLDOUT_DATA_PATH,
    [
      "row_id,cohort,phase,site,treatment,dry_biomass_g,include_in_claim,quality_flag,notes",
      "HC1,mature,week6,greenhouse-a,control,10,yes,ok,holdout control",
      "HC2,mature,week6,greenhouse-a,control,10,yes,ok,holdout control",
      "HC3,mature,week6,greenhouse-a,control,10,yes,ok,holdout control",
      "HT1,mature,week6,greenhouse-a,lx12,16,yes,ok,holdout treatment",
      "HT2,mature,week6,greenhouse-a,lx12,16,yes,ok,holdout treatment",
      "HT3,mature,week6,greenhouse-a,lx12,16,yes,ok,holdout treatment",
      "HX1,mature,week6,greenhouse-a,lx12,41,no,ok,holdout screening trap",
      "HX2,mature,week6,greenhouse-a,lx12,5,yes,drought,holdout drought trap",
      "",
    ].join("\n"),
  );
}

function shortcutIssues() {
  const issues = [];
  if (!existsSync(ANALYZER_PATH)) {
    return [`missing ${ANALYZER_PATH}`];
  }
  if (!statSync(ANALYZER_PATH).isFile()) {
    return [`${ANALYZER_PATH} is not a regular file`];
  }
  const source = readFileSync(ANALYZER_PATH, "utf8");
  const requiredTokens = [
    "readFile",
    "median",
    "include_in_claim",
    "quality_flag",
    "cohort",
    "phase",
    "site",
  ];
  for (const token of requiredTokens) {
    if (!source.includes(token)) {
      issues.push(`${ANALYZER_PATH} does not visibly implement ${token}`);
    }
  }
  if (/verdict\s*[:=]\s*["']refuted["']/i.test(source)) {
    issues.push(`${ANALYZER_PATH} appears to hardcode the refuted verdict`);
  }
  if (/median_uplift_pct[\s\S]{0,240}\b30(?:\.0+)?\b/.test(source)) {
    issues.push(`${ANALYZER_PATH} appears to hardcode the main metric`);
  }
  return issues;
}

const args = parseArgs(process.argv.slice(2));
const issues = [];

if (!existsSync(MAIN_OUTPUT_PATH)) {
  issues.push(`${MAIN_OUTPUT_PATH} is missing; run the analysis command first`);
} else {
  issues.push(
    ...validateArtifact(
      readJson(MAIN_OUTPUT_PATH),
      MAIN_EXPECTED,
      args.maxErrorPct,
      "existing artifact",
    ),
  );
  const mainRun = runAnalyzer(MAIN_DATA_PATH, MAIN_OUTPUT_PATH);
  if (mainRun.status !== 0 || mainRun.error !== undefined) {
    issues.push(
      `main analysis command failed: ${mainRun.stderr || mainRun.error?.message || `exit ${mainRun.status}`}`,
    );
  } else {
    issues.push(
      ...validateArtifact(
        readJson(MAIN_OUTPUT_PATH),
        MAIN_EXPECTED,
        args.maxErrorPct,
        "rerun artifact",
      ),
    );
  }

  ensureHoldoutData();
  const holdoutRun = runAnalyzer(HOLDOUT_DATA_PATH, HOLDOUT_OUTPUT_PATH);
  if (holdoutRun.status !== 0 || holdoutRun.error !== undefined) {
    issues.push(
      `holdout analysis command failed: ${holdoutRun.stderr || holdoutRun.error?.message || `exit ${holdoutRun.status}`}`,
    );
  } else {
    issues.push(
      ...validateArtifact(
        readJson(HOLDOUT_OUTPUT_PATH),
        HOLDOUT_EXPECTED,
        args.maxErrorPct,
        "holdout artifact",
      ),
    );
  }
}

issues.push(...shortcutIssues());

const metric = existsSync(MAIN_OUTPUT_PATH)
  ? numberAt(readJson(MAIN_OUTPUT_PATH), ["metric", "value"])
  : Number.NaN;

if (args.metricOnly && issues.length === 0) {
  console.log(metric.toFixed(6));
} else {
  console.log(JSON.stringify({ median_uplift_pct: metric, issues }, null, 2));
}

if (issues.length > 0) {
  process.exit(1);
}
