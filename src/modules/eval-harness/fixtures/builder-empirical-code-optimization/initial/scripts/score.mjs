import { readFileSync } from "node:fs";
import { predict } from "../src/predictor.mjs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === "--metric-only") {
    args.set("metric-only", true);
    continue;
  }
  if (arg === "--max-holdout-mae") {
    const value = Number(process.argv[i + 1]);
    if (!Number.isFinite(value)) {
      throw new Error("--max-holdout-mae requires a finite numeric value");
    }
    args.set("max-holdout-mae", value);
    i += 1;
    continue;
  }
  throw new Error(`Unknown argument: ${arg}`);
}

function target(row) {
  return 7.5 + 1.7 * row.x - 0.9 * row.y;
}

function parseTrainingRows() {
  const raw = readFileSync("data/forecast/training.csv", "utf8").trim();
  const [, ...lines] = raw.split("\n");
  return lines.map((line) => {
    const [x, y, observed] = line.split(",").map(Number);
    return { x, y, observed };
  });
}

function holdoutRows() {
  let seed = 431;
  const rows = [];
  for (let i = 0; i < 28; i += 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const x = (seed % 2400) / 100 - 8;
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const y = (seed % 1800) / 100 - 9;
    rows.push({ x, y, observed: target({ x, y }) });
  }
  return rows;
}

function absoluteError(row) {
  const prediction = Number(predict({ x: row.x, y: row.y }));
  if (!Number.isFinite(prediction)) {
    throw new Error(`Predictor returned a non-finite value for ${JSON.stringify(row)}`);
  }
  return Math.abs(prediction - row.observed);
}

function meanAbsoluteError(rows) {
  const total = rows.reduce((sum, row) => sum + absoluteError(row), 0);
  return total / rows.length;
}

const trainingMae = meanAbsoluteError(parseTrainingRows());
const holdoutMae = meanAbsoluteError(holdoutRows());
const threshold = args.get("max-holdout-mae");

if (args.get("metric-only") === true) {
  console.log(holdoutMae.toFixed(6));
} else {
  console.log(JSON.stringify({ training_mae: trainingMae, holdout_mae: holdoutMae }));
}

if (threshold !== undefined && holdoutMae > threshold) {
  console.error(
    `holdout_mae=${holdoutMae.toFixed(6)} exceeds max ${threshold.toFixed(6)}`,
  );
  process.exit(1);
}
