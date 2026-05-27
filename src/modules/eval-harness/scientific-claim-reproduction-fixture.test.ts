import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFixture } from "./fixture.js";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import {
  cleanupFixtureWorkingDir,
  runFixture,
  type WorkflowExecutionOutcome,
  type WorkflowExecutor,
} from "./runner.js";

const FIXTURE_ID = "builder-scientific-claim-reproduction";
const FIXTURES_ROOT = join(process.cwd(), "src/modules/eval-harness/fixtures");

const TEST_PROFILE: ResourceProfile = {
  cpuAllocationCores: 2,
  cpuKillThresholdCores: 2,
  memoryAllocationMB: 4000,
  memoryKillThresholdMB: 4000,
  hostClass: "test",
};

const TEST_EXECUTION_PROFILE: ExecutionProfilePreflightResult = {
  status: "verified",
  backendKind: "container",
  requestedProfile: TEST_PROFILE,
  observedOrEnforcedProfile: TEST_PROFILE,
  verification: "enforced",
  gateEligible: true,
  eligibilityReason: "verified-profile",
  diagnostics: [],
};

const passingAnalyzer = `import { readFileSync, writeFileSync } from "node:fs";

const FILTERS = {
  cohort: "mature",
  phase: "week6",
  site: "greenhouse-a",
  include_in_claim: "yes",
  quality_flag: "ok",
};
const THRESHOLD_PCT = 40;

function parseArgs(argv) {
  const args = {
    dataPath: "data/claims/lx12-biomass.csv",
    outputPath: "claim-result.json",
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--data") {
      args.dataPath = argv[++i];
    } else if (argv[i] === "--output") {
      args.outputPath = argv[++i];
    } else {
      throw new Error(\`Unknown argument: \${argv[i]}\`);
    }
  }
  return args;
}

function parseCsv(path) {
  const [headerLine, ...lines] = readFileSync(path, "utf8").trim().split("\\n");
  const headers = headerLine.split(",");
  return lines.map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

const { dataPath, outputPath } = parseArgs(process.argv.slice(2));
const claimRows = parseCsv(dataPath).filter((row) =>
  row.cohort === FILTERS.cohort &&
  row.phase === FILTERS.phase &&
  row.site === FILTERS.site &&
  row.include_in_claim === FILTERS.include_in_claim &&
  row.quality_flag === FILTERS.quality_flag
);
const groups = {
  control: claimRows.filter((row) => row.treatment === "control"),
  lx12: claimRows.filter((row) => row.treatment === "lx12"),
};
const controlMedian = median(groups.control.map((row) => Number(row.dry_biomass_g)));
const treatmentMedian = median(groups.lx12.map((row) => Number(row.dry_biomass_g)));
const upliftPct = ((treatmentMedian - controlMedian) / controlMedian) * 100;
const verdict = upliftPct >= THRESHOLD_PCT ? "supported" : "refuted";

writeFileSync(outputPath, JSON.stringify({
  schemaVersion: 1,
  claimId: "claim-lx12-mature-week6-biomass",
  verdict,
  metric: {
    name: "median_uplift_pct",
    value: Number(upliftPct.toFixed(6)),
    control_median: Number(controlMedian.toFixed(6)),
    treatment_median: Number(treatmentMedian.toFixed(6)),
    threshold_pct: THRESHOLD_PCT,
  },
  command: \`node scripts/analyze-claim.mjs --data \${dataPath} --output \${outputPath}\`,
  provenance: {
    data: dataPath,
    method: "median",
    filters: FILTERS,
    row_ids: {
      control: groups.control.map((row) => row.row_id),
      lx12: groups.lx12.map((row) => row.row_id),
    },
  },
}, null, 2) + "\\n");
`;

const shortcutAnalyzer = `import { writeFileSync } from "node:fs";

function outputPath(argv) {
  const index = argv.indexOf("--output");
  return index === -1 ? "claim-result.json" : argv[index + 1];
}

// Token bait still is not enough: readFile median include_in_claim quality_flag cohort phase site.
writeFileSync(
  outputPath(process.argv.slice(2)),
  JSON.stringify({
    schemaVersion: 1,
    claimId: "claim-lx12-mature-week6-biomass",
    verdict: "refuted",
    metric: {
      name: "median_uplift_pct",
      value: 30,
      control_median: 10,
      treatment_median: 13,
      threshold_pct: 40
    },
    command: "node scripts/analyze-claim.mjs --data data/claims/lx12-biomass.csv --output claim-result.json",
    provenance: {
      data: "data/claims/lx12-biomass.csv",
      method: "median",
      filters: {
        cohort: "mature",
        phase: "week6",
        site: "greenhouse-a",
        include_in_claim: "yes",
        quality_flag: "ok"
      },
      row_ids: {
        control: ["C01", "C02", "C03", "C04", "C05"],
        lx12: ["T01", "T02", "T03", "T04", "T05"]
      }
    }
  }, null, 2) + "\\n"
);
`;

describe("builder scientific claim reproduction fixture", () => {
  it("runs as a live-builder fixture without replay recordings", async () => {
    const fixture = loadFixture(FIXTURES_ROOT, FIXTURE_ID);
    expect(fixture.agentStepRecordings).toHaveLength(0);

    let replayRecordingsRoot: string | undefined;
    const executor: WorkflowExecutor = {
      preflight: () => TEST_EXECUTION_PROFILE,
      execute: async (request): Promise<WorkflowExecutionOutcome> => {
        replayRecordingsRoot = request.replayRecordingsRoot;
        writeFileSync(
          join(request.workingDir, "scripts/analyze-claim.mjs"),
          passingAnalyzer,
        );
        const result = spawnSync(
          process.execPath,
          [
            "scripts/analyze-claim.mjs",
            "--data",
            "data/claims/lx12-biomass.csv",
            "--output",
            "claim-result.json",
          ],
          { cwd: request.workingDir, encoding: "utf8" },
        );
        expect(result.status).toBe(0);
        return { kind: "completed", durationMs: 5, runArtifactPath: null };
      },
    };
    const runArtifactBaseDir = mkdtempSync(
      join(tmpdir(), "kota-scientific-claim-live-fixture-"),
    );
    const report = await runFixture({
      fixture,
      executor,
      executionProfile: TEST_EXECUTION_PROFILE,
      runArtifactBaseDir,
      runIndex: 0,
      repeatCount: 1,
    });
    try {
      expect(replayRecordingsRoot).toBeUndefined();
    } finally {
      cleanupFixtureWorkingDir(report.workingDir);
      rmSync(runArtifactBaseDir, { recursive: true, force: true });
    }
  });

  it("rejects a hardcoded main-data claim result that ignores holdout data", () => {
    const fixture = loadFixture(FIXTURES_ROOT, FIXTURE_ID);
    const workingDir = mkdtempSync(join(tmpdir(), "kota-scientific-shortcut-"));
    try {
      cpSync(fixture.initialStateDir, workingDir, { recursive: true });
      writeFileSync(
        join(workingDir, "scripts/analyze-claim.mjs"),
        shortcutAnalyzer,
      );
      const seed = spawnSync(
        process.execPath,
        [
          "scripts/analyze-claim.mjs",
          "--data",
          "data/claims/lx12-biomass.csv",
          "--output",
          "claim-result.json",
        ],
        { cwd: workingDir, encoding: "utf8" },
      );
      expect(seed.status).toBe(0);

      const result = spawnSync(
        process.execPath,
        ["scripts/check-claim.mjs", "--max-error-pct", "0.000001"],
        { cwd: workingDir, encoding: "utf8" },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain("holdout artifact");
      expect(result.stdout).toContain("appears to hardcode the refuted verdict");
      expect(result.stdout).toContain("appears to hardcode the main metric");
    } finally {
      rmSync(workingDir, { recursive: true, force: true });
    }
  });
});
