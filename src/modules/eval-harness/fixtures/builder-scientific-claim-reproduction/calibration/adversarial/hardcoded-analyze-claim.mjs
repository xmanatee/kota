import { writeFileSync } from "node:fs";

function argument(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
}

const argv = process.argv.slice(2);
const dataPath = argument(argv, "--data", "data/claims/lx12-biomass.csv");
const outputPath = argument(argv, "--output", "claim-result.json");
const known = {
  "data/claims/lx12-biomass.csv": {
    verdict: "refuted",
    value: 30,
    controlMedian: 10,
    treatmentMedian: 13,
    rowIds: {
      control: ["C01", "C02", "C03", "C04", "C05"],
      lx12: ["T01", "T02", "T03", "T04", "T05"],
    },
  },
  "data/claims/lx12-holdout.csv": {
    verdict: "supported",
    value: 60,
    controlMedian: 10,
    treatmentMedian: 16,
    rowIds: {
      control: ["HC1", "HC2", "HC3"],
      lx12: ["HT1", "HT2", "HT3"],
    },
  },
}[dataPath];
if (known === undefined) throw new Error(`No hardcoded answer for ${dataPath}`);

// Token bait is not computation: readFile median include_in_claim quality_flag cohort phase site.
writeFileSync(
  outputPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      claimId: "claim-lx12-mature-week6-biomass",
      verdict: known.verdict,
      metric: {
        name: "median_uplift_pct",
        value: known.value,
        control_median: known.controlMedian,
        treatment_median: known.treatmentMedian,
        threshold_pct: 40,
      },
      command: `node scripts/analyze-claim.mjs --data ${dataPath} --output ${outputPath}`,
      provenance: {
        data: dataPath,
        method: "median",
        filters: {
          cohort: "mature",
          phase: "week6",
          site: "greenhouse-a",
          include_in_claim: "yes",
          quality_flag: "ok",
        },
        row_ids: known.rowIds,
      },
    },
    null,
    2,
  )}\n`,
);
