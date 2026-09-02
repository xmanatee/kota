import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { type LineNode, line, plain, span, stack } from "#modules/rendering/primitives.js";
import { print, writeJson } from "#modules/rendering/transport.js";
import { formatDuration, statusIcon } from "../utils.js";
import {
  requireWorkflowRunDurableAuthority,
  workflowRunStoreWithDurableAuthority,
} from "./workflow-history.js";

type StepRecord = WorkflowRunMetadata["steps"][number];
type WorkflowRunStepLookup =
  | Readonly<{ kind: "found"; step: StepRecord }>
  | Readonly<{ kind: "run-not-found" }>
  | Readonly<{ kind: "step-not-found" }>;

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
    if (step.usage !== undefined) {
      const cost = step.usage.cost.state === "complete"
        ? `$${step.usage.cost.usd.toFixed(4)}`
        : step.usage.cost.state;
      lines.push(line(plain(`  Cost:  ${cost}`)));
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
  return store.resolveRunIdPrefix(runId);
}

export function readWorkflowRunStep(
  store: WorkflowRunStore,
  runId: string,
  stepId: string,
): WorkflowRunStepLookup {
  const run = store.getRun(runId);
  if (run === null) return { kind: "run-not-found" };
  const step = run.steps.find((candidate) => candidate.id === stepId);
  return step === undefined
    ? { kind: "step-not-found" }
    : { kind: "found", step };
}

export function registerStepInspectCommand(wfCmd: Command, ctx: ModuleContext): void {
  wfCmd
    .command("step-inspect <run-id> <step-id>")
    .description("Print the output of a specific step from a run")
    .option("--format <fmt>", "Output format: json (default) or summary", "json")
    .action(async (runId: string, stepId: string, options: { format: string }) => {
      const status = await ctx.client.workflow.status();
      const store = workflowRunStoreWithDurableAuthority(
        ctx.cwd,
        requireWorkflowRunDurableAuthority(
          status.authorityCriticalRunIds,
          status.operationallyActiveRunIds,
          status.terminalRunIds,
        ),
      );
      const resolvedId = resolveRunId(store, runId);

      if (!resolvedId) {
        print(line(span(`Run "${runId}" not found.`, "error")));
        process.exit(1);
      }

      const result = readWorkflowRunStep(store, resolvedId, stepId);
      if (result.kind === "run-not-found") {
        print(line(span(`Run "${resolvedId}" not found.`, "error")));
        process.exit(1);
      }
      if (result.kind === "step-not-found") {
        print(line(span(`Step "${stepId}" not found in run "${resolvedId}".`, "error")));
        process.exit(1);
      }
      const { step } = result;

      if (options.format === "summary") {
        printSummary(step);
      } else {
        writeJson(step, { pretty: true });
      }
    });
}
