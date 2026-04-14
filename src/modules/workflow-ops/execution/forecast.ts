import { join } from "node:path";
import type { Command } from "commander";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { getWorkflowCostForecast, type WorkflowCostForecast } from "#core/workflow/cost-forecast.js";

function printForecast(forecast: WorkflowCostForecast): void {
  console.log(`Workflow:   ${forecast.workflow}`);
  console.log(`Forecast:   $${forecast.baselineAvgCostUsd.toFixed(4)} per run`);
  console.log(`Sample:     ${forecast.sampleSize} run(s)`);
  console.log(`Confidence: ${forecast.confidence}`);
  console.log(`Updated:    ${forecast.updatedAt}`);
  if (forecast.stale) {
    console.log(`Warning:    baseline is stale (>30 days old)`);
  }
}

export function registerForecastCommand(wfCmd: Command): void {
  wfCmd
    .command("forecast")
    .description("Show expected cost for a single workflow run based on historical baselines")
    .argument("<name>", "Workflow name")
    .option("--json", "Output as JSON")
    .action(async (name: string, opts: { json?: boolean }) => {
      const client = DaemonControlClient.fromStateDir();
      let forecast: WorkflowCostForecast | null = null;

      if (client) {
        forecast = await client.getWorkflowCostForecast(name);
      }

      if (!forecast) {
        const kotaDir = join(process.cwd(), ".kota");
        forecast = getWorkflowCostForecast(kotaDir, name);
      }

      if (!forecast) {
        console.error(`No baseline data available for workflow "${name}".`);
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(forecast, null, 2));
        return;
      }

      printForecast(forecast);
    });
}
