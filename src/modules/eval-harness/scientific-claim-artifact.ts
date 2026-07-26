import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const SCIENTIFIC_CLAIM_ANALYZER_PATH = "scripts/analyze-claim.mjs";

const CLAIM_ID = "claim-lx12-mature-week6-biomass";
const METRIC_NAME = "median_uplift_pct";
const THRESHOLD_PCT = 40;
const ARTIFACT_MAX_BYTES = 256 * 1024;
const EXPECTED_FILTERS: { readonly [key: string]: string } = {
  cohort: "mature",
  phase: "week6",
  site: "greenhouse-a",
  include_in_claim: "yes",
  quality_flag: "ok",
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | readonly JsonValue[];
type JsonObject = { readonly [key: string]: JsonValue | undefined };

export type ScientificClaimExpected = {
  dataPath: string;
  outputPath: string;
  verdict: "supported" | "refuted";
  controlMedian: number;
  treatmentMedian: number;
  upliftPct: number;
  rowIds: {
    control: readonly string[];
    lx12: readonly string[];
  };
};

export const MAIN_CLAIM_EXPECTED: ScientificClaimExpected = {
  dataPath: "data/claims/lx12-biomass.csv",
  outputPath: "claim-result.json",
  verdict: "refuted",
  controlMedian: 10,
  treatmentMedian: 13,
  upliftPct: 30,
  rowIds: {
    control: ["C01", "C02", "C03", "C04", "C05"],
    lx12: ["T01", "T02", "T03", "T04", "T05"],
  },
};

export const HOLDOUT_CLAIM_EXPECTED: ScientificClaimExpected = {
  dataPath: "data/claims/lx12-holdout.csv",
  outputPath: "claim-holdout-result.json",
  verdict: "supported",
  controlMedian: 10,
  treatmentMedian: 16,
  upliftPct: 60,
  rowIds: {
    control: ["HC1", "HC2", "HC3"],
    lx12: ["HT1", "HT2", "HT3"],
  },
};

export const VERIFIER_CLAIM_EXPECTED: ScientificClaimExpected = {
  dataPath: "data/claims/lx12-verifier.csv",
  outputPath: "claim-verifier-result.json",
  verdict: "supported",
  controlMedian: 23,
  treatmentMedian: 34,
  upliftPct: 47.826087,
  rowIds: {
    control: ["VC1", "VC2", "VC3", "VC4"],
    lx12: ["VT1", "VT2", "VT3", "VT4"],
  },
};

export const VERIFIER_CLAIM_CSV = `row_id,cohort,phase,site,treatment,dry_biomass_g,include_in_claim,quality_flag,notes
VC1,mature,week6,greenhouse-a,control,19,yes,ok,verifier control
VC2,mature,week6,greenhouse-a,control,22,yes,ok,verifier control
VC3,mature,week6,greenhouse-a,control,24,yes,ok,verifier control
VC4,mature,week6,greenhouse-a,control,28,yes,ok,verifier control
VT1,mature,week6,greenhouse-a,lx12,29,yes,ok,verifier treatment
VT2,mature,week6,greenhouse-a,lx12,33,yes,ok,verifier treatment
VT3,mature,week6,greenhouse-a,lx12,35,yes,ok,verifier treatment
VT4,mature,week6,greenhouse-a,lx12,42,yes,ok,verifier treatment
VX1,mature,week6,greenhouse-a,lx12,90,no,ok,excluded screening row
VX2,mature,week6,greenhouse-a,lx12,4,yes,drought,excluded quality row
VX3,juvenile,week6,greenhouse-a,lx12,80,yes,ok,excluded cohort row
VX4,mature,week4,greenhouse-a,control,2,yes,ok,excluded phase row
VX5,mature,week6,greenhouse-b,control,3,yes,ok,excluded site row
`;

type ParsedJsonObject =
  | { ok: true; value: JsonObject }
  | { ok: false; issue: string };

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: JsonValue | undefined): JsonObject {
  return isJsonObject(value) ? value : {};
}

function numberAt(record: JsonObject, path: readonly string[]): number {
  let value: JsonValue | undefined = record;
  for (const key of path) value = asObject(value)[key];
  return typeof value === "number" ? value : Number.NaN;
}

function arraysEqual(actual: JsonValue | undefined, expected: readonly string[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function readJsonObject(root: string, path: string, label: string): ParsedJsonObject {
  const absolute = join(root, path);
  if (!existsSync(absolute)) {
    return { ok: false, issue: `${label}: ${path} is missing` };
  }
  try {
    const file = lstatSync(absolute);
    if (!file.isFile()) {
      return { ok: false, issue: `${label}: ${path} must be a regular file` };
    }
    if (file.size > ARTIFACT_MAX_BYTES) {
      return {
        ok: false,
        issue: `${label}: ${path} exceeds ${ARTIFACT_MAX_BYTES} bytes`,
      };
    }
    const parsed: JsonValue = JSON.parse(readFileSync(absolute, "utf-8"));
    if (!isJsonObject(parsed)) {
      return { ok: false, issue: `${label}: ${path} is not a JSON object` };
    }
    return { ok: true, value: parsed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, issue: `${label}: ${path} is not valid JSON: ${message}` };
  }
}

function validateArtifact(
  artifact: JsonObject,
  expected: ScientificClaimExpected,
  tolerance: number,
  label: string,
): string[] {
  const issues: string[] = [];
  if (artifact.schemaVersion !== 1) issues.push(`${label}: schemaVersion must be 1`);
  if (artifact.claimId !== CLAIM_ID) issues.push(`${label}: claimId must be ${CLAIM_ID}`);
  if (artifact.verdict !== expected.verdict) {
    issues.push(`${label}: verdict ${JSON.stringify(artifact.verdict)} is not ${expected.verdict}`);
  }

  const metric = asObject(artifact.metric);
  if (metric.name !== METRIC_NAME) issues.push(`${label}: metric.name must be ${METRIC_NAME}`);
  const metricChecks = [
    ["metric.value", numberAt(artifact, ["metric", "value"]), expected.upliftPct],
    ["metric.control_median", numberAt(artifact, ["metric", "control_median"]), expected.controlMedian],
    ["metric.treatment_median", numberAt(artifact, ["metric", "treatment_median"]), expected.treatmentMedian],
    ["metric.threshold_pct", numberAt(artifact, ["metric", "threshold_pct"]), THRESHOLD_PCT],
  ] as const;
  for (const [name, actual, expectedValue] of metricChecks) {
    if (!Number.isFinite(actual) || Math.abs(actual - expectedValue) > tolerance) {
      issues.push(`${label}: ${name} ${actual} differs from expected ${expectedValue}`);
    }
  }

  const expectedCommand =
    `node ${SCIENTIFIC_CLAIM_ANALYZER_PATH} --data ${expected.dataPath} --output ${expected.outputPath}`;
  if (artifact.command !== expectedCommand) {
    issues.push(`${label}: command must be ${JSON.stringify(expectedCommand)}`);
  }

  const provenance = asObject(artifact.provenance);
  if (provenance.data !== expected.dataPath) {
    issues.push(`${label}: provenance.data must be ${expected.dataPath}`);
  }
  if (provenance.method !== "median") issues.push(`${label}: provenance.method must be "median"`);
  const filters = asObject(provenance.filters);
  for (const [key, value] of Object.entries(EXPECTED_FILTERS)) {
    if (filters[key] !== value) issues.push(`${label}: provenance.filters.${key} must be ${value}`);
  }
  const rowIds = asObject(provenance.row_ids);
  if (!arraysEqual(rowIds.control, expected.rowIds.control)) {
    issues.push(`${label}: provenance.row_ids.control must be ${expected.rowIds.control.join(",")}`);
  }
  if (!arraysEqual(rowIds.lx12, expected.rowIds.lx12)) {
    issues.push(`${label}: provenance.row_ids.lx12 must be ${expected.rowIds.lx12.join(",")}`);
  }
  return issues;
}

export function validateScientificClaimArtifactFile(
  root: string,
  expected: ScientificClaimExpected,
  tolerance: number,
  label: string,
): string[] {
  const parsed = readJsonObject(root, expected.outputPath, label);
  return parsed.ok
    ? validateArtifact(parsed.value, expected, tolerance, label)
    : [parsed.issue];
}
