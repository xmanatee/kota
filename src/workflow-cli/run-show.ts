import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { readOptionalJsonFile } from "../json-file.js";
import { DaemonControlClient } from "../server/daemon-client.js";
import { WorkflowRunStore } from "../workflow/run-store.js";
import type { RepairSummary } from "../workflow/run-store-helpers.js";
import { extractRepairSummary } from "../workflow/run-store-helpers.js";
import type { WorkflowRunMetadata } from "../workflow/run-types.js";
import { formatDuration, statusIcon } from "./utils.js";

export function formatRepairLine(summary: RepairSummary): string {
  const noun = summary.attempts === 1 ? "repair" : "repairs";
  const costPart = summary.totalCostUsd > 0 ? ` ($${summary.totalCostUsd.toFixed(3)})` : "";
  const parts = summary.failedChecksByAttempt.map(
    (failures, i) => `[${i + 1}] ${failures.length > 0 ? failures.join(", ") : "passed"}`,
  );
  return `Repairs: ${summary.attempts} ${noun}${costPart} — ${parts.join(" / ")}`;
}

export function registerRunShowCommand(wfCmd: Command): void {
  wfCmd
    .command("show <run-id>")
    .description("Show step-level details for a specific run")
    .option("--step <step-id>", "Print the full output of a specific step as JSON")
    .action(async (runId, options) => {
      const stepId = options.step as string | undefined;
      const store = new WorkflowRunStore();

      // Support prefix matching via disk
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

      // Try daemon API first, fall back to disk.
      // Skip daemon when --step is requested since that needs full step output.
      const daemonClient = stepId === undefined ? DaemonControlClient.fromStateDir() : null;
      const daemonRun = daemonClient ? await daemonClient.getWorkflowRun(resolvedId) : null;

      let metadata: WorkflowRunMetadata;
      if (daemonRun) {
        // Reconstruct a WorkflowRunMetadata-compatible shape from daemon response
        metadata = {
          id: daemonRun.id,
          workflow: daemonRun.workflow,
          definitionPath: "",
          trigger: { event: daemonRun.triggerEvent, payload: {} },
          startedAt: daemonRun.startedAt,
          status: daemonRun.status as WorkflowRunMetadata["status"],
          runDir: "",
          steps: daemonRun.steps.map((s) => ({
            id: s.id,
            type: s.type as WorkflowRunMetadata["steps"][number]["type"],
            status: s.status as "success" | "failed" | "skipped",
            startedAt: daemonRun.startedAt,
            completedAt: daemonRun.completedAt ?? daemonRun.startedAt,
            durationMs: s.durationMs,
            error: s.error,
            ...(s.costUsd != null && { output: { totalCostUsd: s.costUsd } }),
          })),
          ...(daemonRun.completedAt != null && { completedAt: daemonRun.completedAt }),
          ...(daemonRun.durationMs != null && { durationMs: daemonRun.durationMs }),
          ...(daemonRun.totalCostUsd != null && { totalCostUsd: daemonRun.totalCostUsd }),
          ...(daemonRun.triggeredByRunId != null && { triggeredByRunId: daemonRun.triggeredByRunId }),
          ...(daemonRun.causedBy != null && { causedBy: daemonRun.causedBy }),
          ...(daemonRun.retryOf != null && { retryOf: daemonRun.retryOf }),
        };
      } else {
        const metadataPath = join(store.runsDir, resolvedId, "metadata.json");
        const diskMeta = readOptionalJsonFile<WorkflowRunMetadata>(metadataPath);
        if (!diskMeta) {
          console.error(`Run "${resolvedId}" not found.`);
          process.exit(1);
        }
        metadata = diskMeta;
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
      if (metadata.tags && metadata.tags.length > 0) {
        console.log(`Tags:     ${metadata.tags.join(", ")}`);
      }
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

          if (step.type === "parallel") {
            console.log(`  ${icon} ${step.id} [parallel] ${dur}${suffix}`);
            if (step.error) {
              console.log(`      Error: ${step.error}`);
            }
            const inner = (step.output as { steps?: Array<{ id: string; type: string; status: string; durationMs: number; error?: string; continueOnFailure?: boolean }> } | null)?.steps ?? [];
            for (const childStep of inner) {
              const childIcon = childStep.status === "failed" && childStep.continueOnFailure ? "⚠" : statusIcon(childStep.status as "success" | "failed" | "skipped");
              const childSuffix = childStep.status === "failed" && childStep.continueOnFailure ? " (continued)" : "";
              console.log(`    ║ ${childIcon} ${childStep.id} [${childStep.type}] ${formatDuration(childStep.durationMs)}${childSuffix}`);
              if (childStep.error) {
                console.log(`          Error: ${childStep.error}`);
              }
            }
            continue;
          }

          const stepOutput = step.output as { totalCostUsd?: unknown } | null | undefined;
          const repairSummary = extractRepairSummary(step.output);
          const agentCost = step.type === "agent" && typeof stepOutput?.totalCostUsd === "number"
            ? stepOutput.totalCostUsd
            : null;
          const totalStepCost = agentCost !== null
            ? agentCost + (repairSummary?.totalCostUsd ?? 0)
            : null;
          const cost = totalStepCost !== null ? ` $${totalStepCost.toFixed(3)}` : "";
          console.log(`  ${icon} ${step.id} [${step.type}] ${dur}${cost}${suffix}`);
          if (step.error) {
            console.log(`      Error: ${step.error}`);
          }
          if (repairSummary) {
            console.log(`      ${formatRepairLine(repairSummary)}`);
          }
          if (step.output !== undefined && step.output !== null) {
            const outputSummary = JSON.stringify(step.output);
            const trimmed = outputSummary.length > 120 ? `${outputSummary.slice(0, 120)}…` : outputSummary;
            console.log(`      Output: ${trimmed}`);
          }
        }
      }
    });
}
