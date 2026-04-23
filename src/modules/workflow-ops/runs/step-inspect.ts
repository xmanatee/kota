import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { type LineNode, line, plain, span, stack } from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { formatDuration, statusIcon } from "../utils.js";

type StepRecord = WorkflowRunMetadata["steps"][number];

export function buildStepSummaryLines(step: StepRecord): LineNode[] {
  const icon = statusIcon(step.status);
  const dur = formatDuration(step.durationMs);
  const lines: LineNode[] = [
    line(plain(`Step:     ${step.id}`)),
    line(plain(`Type:     ${step.type}`)),
    line(plain(`Status:   ${icon} ${step.status}`)),
    line(plain(`Duration: ${dur}`)),
  ];
  if (step.startedAt) {
    lines.push(line(plain(`Started:  ${new Date(step.startedAt).toLocaleString()}`)));
  }
  if (step.completedAt) {
    lines.push(line(plain(`Finished: ${new Date(step.completedAt).toLocaleString()}`)));
  }

  if (step.error) {
    lines.push(line(plain("")));
    lines.push(line(plain("Error:")));
    for (const errLine of step.error.split("\n")) {
      lines.push(line(plain(errLine)));
    }
    return lines;
  }

  if (step.output === null || step.output === undefined) {
    lines.push(line(plain("")));
    lines.push(line(plain("Output: (none)")));
    return lines;
  }

  const output = step.output as Record<string, unknown>;
  lines.push(line(plain("")));
  lines.push(line(plain("Output:")));

  if (step.type === "agent") {
    if (step.harness) {
      lines.push(line(plain(`  Harness: ${step.harness}`)));
    }
    if (step.model) {
      lines.push(line(plain(`  Model:   ${step.model}`)));
    }
    if (typeof output.totalCostUsd === "number") {
      lines.push(line(plain(`  Cost:  $${(output.totalCostUsd as number).toFixed(4)}`)));
    }
    if (typeof output.turns === "number") {
      lines.push(line(plain(`  Turns: ${output.turns}`)));
    }
    if (typeof output.content === "string") {
      const content = output.content as string;
      const preview = content.length > 300 ? `${content.slice(0, 300)}…` : content;
      lines.push(line(plain("  Content:")));
      for (const contentLine of preview.split("\n")) {
        lines.push(line(plain(`    ${contentLine}`)));
      }
    }
  } else {
    const serialized = JSON.stringify(output);
    const trimmed = serialized.length > 400 ? `${serialized.slice(0, 400)}…` : serialized;
    lines.push(line(plain(`  ${trimmed}`)));
  }
  return lines;
}

export function printSummary(step: StepRecord): void {
  print(stack(...buildStepSummaryLines(step)));
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
        print(line(span(`Run "${runId}" not found.`, "error")));
        process.exit(1);
      }

      const runDir = join(store.runsDir, resolvedId);
      if (!existsSync(runDir)) {
        print(line(span(`Run "${resolvedId}" not found.`, "error")));
        process.exit(1);
      }

      const stepPath = join(runDir, "steps", `${stepId}.json`);
      const step = readOptionalJsonFile<StepRecord>(stepPath);

      if (!step) {
        print(line(span(`Step "${stepId}" not found in run "${resolvedId}".`, "error")));
        process.exit(1);
      }

      if (options.format === "summary") {
        printSummary(step);
      } else {
        // biome-ignore lint/suspicious/noConsole: structured JSON output path stays on console
        console.log(JSON.stringify(step, null, 2));
      }
    });
}
