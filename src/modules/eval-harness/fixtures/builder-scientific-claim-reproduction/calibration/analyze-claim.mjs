import { readFileSync, writeFileSync } from "node:fs";

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
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function parseCsv(path) {
  const [headerLine, ...lines] = readFileSync(path, "utf8").trim().split("\n");
  const headers = headerLine.split(",");
  return lines.map((line) => {
    const values = line.split(",");
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] ?? ""]),
    );
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
const claimRows = parseCsv(dataPath).filter(
  (row) =>
    row.cohort === FILTERS.cohort &&
    row.phase === FILTERS.phase &&
    row.site === FILTERS.site &&
    row.include_in_claim === FILTERS.include_in_claim &&
    row.quality_flag === FILTERS.quality_flag,
);
const groups = {
  control: claimRows.filter((row) => row.treatment === "control"),
  lx12: claimRows.filter((row) => row.treatment === "lx12"),
};
const controlMedian = median(
  groups.control.map((row) => Number(row.dry_biomass_g)),
);
const treatmentMedian = median(
  groups.lx12.map((row) => Number(row.dry_biomass_g)),
);
const upliftPct = ((treatmentMedian - controlMedian) / controlMedian) * 100;
const verdict = upliftPct >= THRESHOLD_PCT ? "supported" : "refuted";

writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
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
      command: `node scripts/analyze-claim.mjs --data ${dataPath} --output ${outputPath}`,
      provenance: {
        data: dataPath,
        method: "median",
        filters: FILTERS,
        row_ids: {
          control: groups.control.map((row) => row.row_id),
          lx12: groups.lx12.map((row) => row.row_id),
        },
      },
    },
    null,
    2,
  )}\n`,
);
