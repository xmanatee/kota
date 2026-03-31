import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { readOptionalJsonFile } from "../json-file.js";
import { WorkflowRunStore } from "../workflow/run-store.js";
import type { WorkflowRunMetadata } from "../workflow/run-types.js";
import { formatDuration, statusIcon } from "./utils.js";

type StepRecord = WorkflowRunMetadata["steps"][number];

export function printSummary(step: StepRecord): void {
  const icon = statusIcon(step.status);
  const dur = formatDuration(step.durationMs);
  console.log(`Step:     ${step.id}`);
  console.log(`Type:     ${step.type}`);
  console.log(`Status:   ${icon} ${step.status}`);
  console.log(`Duration: ${dur}`);
  if (step.startedAt) {
    console.log(`Started:  ${new Date(step.startedAt).toLocaleString()}`);
  }
  if (step.completedAt) {
    console.log(`Finished: ${new Date(step.completedAt).toLocaleString()}`);
  }

  if (step.error) {
    console.log(`\nError:\n${step.error}`);
    return;
  }

  if (step.output === null || step.output === undefined) {
    console.log("\nOutput: (none)");
    return;
  }

  const output = step.output as Record<string, unknown>;
  console.log("\nOutput:");

  if (step.type === "agent") {
    if (typeof output.totalCostUsd === "number") {
      console.log(`  Cost:  $${(output.totalCostUsd as number).toFixed(4)}`);
    }
    if (typeof output.turns === "number") {
      console.log(`  Turns: ${output.turns}`);
    }
    if (typeof output.content === "string") {
      const content = output.content as string;
      const preview = content.length > 300 ? `${content.slice(0, 300)}…` : content;
      console.log(`  Content:\n    ${preview.replace(/\n/g, "\n    ")}`);
    }
  } else {
    const serialized = JSON.stringify(output);
    const trimmed = serialized.length > 400 ? `${serialized.slice(0, 400)}…` : serialized;
    console.log(`  ${trimmed}`);
  }
}

function resolveRunId(store: WorkflowRunStore, runId: string): string | null {
  if (runId.includes("Z-")) return runId;
  try {
    const dirs = readdirSync(store.runsDir).sort().reverse();
    return dirs.find((d) => d.startsWith(runId)) ?? null;
  } catch {
    return null;
  }
}

export function registerStepInspectCommand(wfCmd: Command): void {
  wfCmd
    .command("step-inspect <run-id> <step-id>")
    .description("Print the output of a specific step from a run")
    .option("--format <fmt>", "Output format: json (default) or summary", "json")
    .action(async (runId: string, stepId: string, options: { format: string }) => {
      const store = new WorkflowRunStore();
      const resolvedId = resolveRunId(store, runId);

      if (!resolvedId) {
        console.error(`Run "${runId}" not found.`);
        process.exit(1);
      }

      const runDir = join(store.runsDir, resolvedId);
      if (!existsSync(runDir)) {
        console.error(`Run "${resolvedId}" not found.`);
        process.exit(1);
      }

      const stepPath = join(runDir, "steps", `${stepId}.json`);
      const step = readOptionalJsonFile<StepRecord>(stepPath);

      if (!step) {
        console.error(`Step "${stepId}" not found in run "${resolvedId}".`);
        process.exit(1);
      }

      if (options.format === "summary") {
        printSummary(step);
      } else {
        console.log(JSON.stringify(step, null, 2));
      }
    });
}
