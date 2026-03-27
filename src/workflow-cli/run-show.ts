import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { readOptionalJsonFile } from "../json-file.js";
import { WorkflowRunStore } from "../workflow/run-store.js";
import type { WorkflowRunMetadata } from "../workflow/types.js";
import { formatDuration, statusIcon } from "./utils.js";

export function registerRunShowCommand(wfCmd: Command): void {
  wfCmd
    .command("show <run-id>")
    .description("Show step-level details for a specific run")
    .option("--step <step-id>", "Print the full output of a specific step as JSON")
    .action((runId, options) => {
      const stepId = options.step as string | undefined;
      const store = new WorkflowRunStore();
      // Support prefix matching
      let resolvedId = runId;
      if (!runId.includes("Z-")) {
        try {
          const dirs = readdirSync(store.runsDir).sort().reverse();
          const match = dirs.find((d) => d.startsWith(runId));
          if (!match) {
            console.error(`Run "${runId}" not found.`);
            process.exit(1);
          }
          resolvedId = match;
        } catch {
          console.error(`Run "${runId}" not found.`);
          process.exit(1);
        }
      }

      const metadataPath = join(store.runsDir, resolvedId, "metadata.json");
      const metadata = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
      if (!metadata) {
        console.error(`Run "${resolvedId}" not found.`);
        process.exit(1);
      }

      if (stepId !== undefined) {
        const step = metadata.steps.find((s) => s.id === stepId);
        if (!step) {
          console.error(`Step "${stepId}" not found in run "${resolvedId}".`);
          process.exit(1);
        }
        if (step.error) {
          console.log(step.error);
        } else {
          console.log(JSON.stringify(step.output, null, 2));
        }
        return;
      }

      const errorPath = join(store.runsDir, resolvedId, "error.txt");
      const errorText = existsSync(errorPath) ? readFileSync(errorPath, "utf-8") : null;

      console.log(`Run:      ${metadata.id}`);
      console.log(`Workflow: ${metadata.workflow}`);
      console.log(`Status:   ${statusIcon(metadata.status)} ${metadata.status}`);
      if (metadata.retryOf) {
        console.log(`Retry of: ${metadata.retryOf}`);
      }
      console.log(`Trigger:  ${metadata.trigger.event}`);
      console.log(`Started:  ${new Date(metadata.startedAt).toLocaleString()}`);
      if (metadata.completedAt) {
        console.log(`Finished: ${new Date(metadata.completedAt).toLocaleString()}`);
      }
      if (metadata.durationMs != null) {
        console.log(`Duration: ${formatDuration(metadata.durationMs)}`);
      }
      if (metadata.totalCostUsd != null) {
        console.log(`Cost:     $${metadata.totalCostUsd.toFixed(4)}`);
      }
      if (errorText !== null) {
        console.log(`\nError:\n${errorText}`);
      }

      if (metadata.steps.length > 0) {
        console.log(`\nSteps (${metadata.steps.length}):`);
        for (const step of metadata.steps) {
          const dur = formatDuration(step.durationMs);
          const icon = step.status === "failed" && step.continueOnFailure ? "⚠" : statusIcon(step.status);
          const suffix = step.status === "failed" && step.continueOnFailure ? " (continued)" : "";
          const stepOutput = step.output as { totalCostUsd?: unknown } | null | undefined;
          const cost = step.type === "agent" && typeof stepOutput?.totalCostUsd === "number"
            ? ` $${stepOutput.totalCostUsd.toFixed(3)}`
            : "";
          console.log(`  ${icon} ${step.id} [${step.type}] ${dur}${cost}${suffix}`);
          if (step.error) {
            console.log(`      Error: ${step.error}`);
          }
          if (step.output !== undefined && step.output !== null) {
            const summary = JSON.stringify(step.output);
            const trimmed = summary.length > 120 ? `${summary.slice(0, 120)}…` : summary;
            console.log(`      Output: ${trimmed}`);
          }
        }
      }
    });
}
