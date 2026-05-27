import { readFileSync, writeFileSync } from "node:fs";

const DEFAULT_DATA = "data/claims/lx12-biomass.csv";
const DEFAULT_OUTPUT = "claim-result.json";

function parseArgs(argv) {
  const args = { dataPath: DEFAULT_DATA, outputPath: DEFAULT_OUTPUT };
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
  const raw = readFileSync(path, "utf8").trim();
  const [headerLine, ...lines] = raw.split("\n");
  const headers = headerLine.split(",");
  return lines.map((line) => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const { dataPath, outputPath } = parseArgs(process.argv.slice(2));
const rows = parseCsv(dataPath);
const controls = rows
  .filter((row) => row.treatment === "control")
  .map((row) => Number(row.dry_biomass_g));
const treated = rows
  .filter((row) => row.treatment === "lx12")
  .map((row) => Number(row.dry_biomass_g));

const controlMean = mean(controls);
const treatedMean = mean(treated);
const upliftPct = ((treatedMean - controlMean) / controlMean) * 100;
const verdict = upliftPct >= 40 ? "supported" : "refuted";

writeFileSync(
  outputPath,
  `${JSON.stringify({
    schemaVersion: 1,
    claimId: "claim-lx12-mature-week6-biomass",
    verdict,
    metric: {
      name: "mean_uplift_pct",
      value: Number(upliftPct.toFixed(6)),
      control_mean: Number(controlMean.toFixed(6)),
      treatment_mean: Number(treatedMean.toFixed(6)),
      threshold_pct: 40,
    },
    command: `node scripts/analyze-claim.mjs --data ${dataPath} --output ${outputPath}`,
    provenance: {
      data: dataPath,
      method: "mean over every visible row",
      filters: {},
    },
  }, null, 2)}\n`,
);
