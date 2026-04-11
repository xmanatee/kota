import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { RepairSummary } from "#core/workflow/run-store-helpers.js";
import { extractRepairSummary } from "#core/workflow/run-store-helpers.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { formatDuration, statusIcon } from "./utils.js";

export function formatWarningsSection(warnings: Array<{ type: string; message: string }>): string[] {
  return warnings.map((w) => `  [${w.type}] ${w.message}`);
}

export function formatRepairLine(summary: RepairSummary): string {
  const noun = summary.attempts === 1 ? "repair" : "repairs";
  const costPart = summary.totalCostUsd > 0 ? ` ($${summary.totalCostUsd.toFixed(3)})` : "";
  const parts = summary.failedChecksByAttempt.map(
    (failures, i) => `[${i + 1}] ${failures.length > 0 ? failures.join(", ") : "passed"}`,
  );
  return `Repairs: ${summary.attempts} ${noun}${costPart} — ${parts.join(" / ")}`;
}

export type ChainNode = {
  id: string;
  workflow: string;
  status: string;
  durationMs?: number;
  children: ChainNode[];
};

async function fetchRunSummary(
  id: string,
  daemonClient: DaemonControlClient | null,
  store: WorkflowRunStore,
): Promise<{ id: string; workflow: string; status: string; durationMs?: number; causedBy?: { runId: string; workflow: string } } | null> {
  if (daemonClient) {
    const run = await daemonClient.getWorkflowRun(id);
    if (run) return { id: run.id, workflow: run.workflow, status: run.status, durationMs: run.durationMs, causedBy: run.causedBy };
  }
  const meta = store.getRun(id);
  if (!meta) return null;
  return { id: meta.id, workflow: meta.workflow, status: meta.status, durationMs: meta.durationMs, causedBy: meta.causedBy };
}

async function fetchChildren(
  parentId: string,
  daemonClient: DaemonControlClient | null,
  store: WorkflowRunStore,
): Promise<Array<{ id: string; workflow: string; status: string; durationMs?: number }>> {
  if (daemonClient) {
    const result = await daemonClient.listWorkflowRuns(undefined, 50, undefined, parentId);
    if (result) return result.runs;
  }
  return store.listRuns({ causedByRunId: parentId, limit: 50 }).map((r) => ({
    id: r.id,
    workflow: r.workflow,
    status: r.status,
    durationMs: r.durationMs,
  }));
}

async function buildChainTree(
  rootId: string,
  daemonClient: DaemonControlClient | null,
  store: WorkflowRunStore,
  depth: number,
  maxDepth: number,
): Promise<ChainNode | null> {
  const run = await fetchRunSummary(rootId, daemonClient, store);
  if (!run) return null;
  const node: ChainNode = { id: run.id, workflow: run.workflow, status: run.status, durationMs: run.durationMs, children: [] };
  if (depth < maxDepth) {
    const children = await fetchChildren(rootId, daemonClient, store);
    for (const child of children) {
      const childNode = await buildChainTree(child.id, daemonClient, store, depth + 1, maxDepth);
      if (childNode) node.children.push(childNode);
    }
  }
  return node;
}

export function printChainTree(node: ChainNode, currentId: string, prefix: string, isLast: boolean, isRoot: boolean): void {
  const connector = isRoot ? "" : isLast ? "└─ " : "├─ ";
  const dur = node.durationMs != null ? ` (${formatDuration(node.durationMs)})` : "";
  const marker = node.id === currentId ? " ← current" : "";
  const icon = statusIcon(node.status);
  console.log(`${prefix}${connector}${icon} ${node.workflow}/${node.id}${dur}${marker}`);
  const childPrefix = isRoot ? prefix : prefix + (isLast ? "   " : "│  ");
  for (let i = 0; i < node.children.length; i++) {
    printChainTree(node.children[i]!, currentId, childPrefix, i === node.children.length - 1, false);
  }
}

export function registerRunShowCommand(wfCmd: Command): void {
  wfCmd
    .command("show <run-id>")
    .description("Show step-level details for a specific run")
    .option("--step <step-id>", "Print the full output of a specific step as JSON")
    .option("--payload", "Print the trigger payload as formatted JSON")
    .option("--chain", "Print the full causal chain tree (max 5 levels deep)")
    .action(async (runId, options) => {
      const stepId = options.step as string | undefined;
      const showPayload = options.payload as boolean | undefined;
      const showChain = options.chain as boolean | undefined;
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
          trigger: { event: daemonRun.triggerEvent, payload: daemonRun.triggerPayload ?? {} },
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
            ...(s.costUsd != null && { costUsd: s.costUsd, output: { totalCostUsd: s.costUsd } }),
          })),
          ...(daemonRun.completedAt != null && { completedAt: daemonRun.completedAt }),
          ...(daemonRun.durationMs != null && { durationMs: daemonRun.durationMs }),
          ...(daemonRun.totalCostUsd != null && { totalCostUsd: daemonRun.totalCostUsd }),
          ...(daemonRun.triggeredByRunId != null && { triggeredByRunId: daemonRun.triggeredByRunId }),
          ...(daemonRun.causedBy != null && { causedBy: daemonRun.causedBy }),
          ...(daemonRun.retryOf != null && { retryOf: daemonRun.retryOf }),
          ...(daemonRun.resumedFromRunId != null && { resumedFromRunId: daemonRun.resumedFromRunId }),
          ...(daemonRun.warnings && daemonRun.warnings.length > 0 && { warnings: daemonRun.warnings }),
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

      if (showChain) {
        // Walk up causedBy chain to find the highest reachable ancestor
        const MAX_DEPTH = 5;
        let rootId = resolvedId;
        let current: { causedBy?: { runId: string; workflow: string } } | null = metadata;
        let depth = 0;
        while (current?.causedBy && depth < MAX_DEPTH) {
          const parent = await fetchRunSummary(current.causedBy.runId, daemonClient, store);
          if (!parent) break;
          rootId = parent.id;
          current = parent;
          depth++;
        }
        const tree = await buildChainTree(rootId, daemonClient, store, 0, MAX_DEPTH);
        if (!tree) {
          console.error(`Could not load chain for run "${resolvedId}".`);
          process.exit(1);
        }
        printChainTree(tree, resolvedId, "", true, true);
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
      if (metadata.resumedFromRunId) {
        console.log(`Resumed from: ${metadata.resumedFromRunId}`);
      }
      console.log(`Trigger:  ${metadata.trigger.event}`);
      if (showPayload && metadata.trigger.payload && Object.keys(metadata.trigger.payload).length > 0) {
        console.log(`Payload:\n${JSON.stringify(metadata.trigger.payload, null, 2).split("\n").map((l) => `  ${l}`).join("\n")}`);
      }
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
      if (metadata.warnings && metadata.warnings.length > 0) {
        console.log(`\nWarnings:`);
        for (const line of formatWarningsSection(metadata.warnings)) {
          console.log(line);
        }
      }

      // Show downstream runs triggered by this run
      let triggeredRuns: { id: string; workflow: string; status: string }[] = [];
      if (daemonRun) {
        const downstreamResult = daemonClient ? await daemonClient.listWorkflowRuns(undefined, 50, undefined, resolvedId) : null;
        if (downstreamResult) {
          triggeredRuns = downstreamResult.runs.map((r) => ({ id: r.id, workflow: r.workflow, status: r.status }));
        }
      } else {
        triggeredRuns = store.listRuns({ causedByRunId: resolvedId, limit: 50 }).map((r) => ({
          id: r.id,
          workflow: r.workflow,
          status: r.status,
        }));
      }
      if (triggeredRuns.length > 0) {
        console.log(`\nTriggered runs (${triggeredRuns.length}):`);
        for (const r of triggeredRuns) {
          console.log(`  ${statusIcon(r.status)} ${r.id} [${r.workflow}]`);
        }
      }

      if (metadata.steps.length > 0) {
        console.log(`\nSteps (${metadata.steps.length}):`);
        for (const step of metadata.steps) {
          const dur = formatDuration(step.durationMs);
          const icon = step.status === "failed" && step.continueOnFailure ? "⚠" : statusIcon(step.status);
          const reusedSuffix = (step as { reused?: boolean }).reused ? " (reused)" : "";
          const suffix = step.status === "failed" && step.continueOnFailure ? " (continued)" : reusedSuffix;

          if (step.type === "parallel") {
            console.log(`  ${icon} ${step.id} [parallel] ${dur}${suffix}`);
            if (step.error) {
              console.log(`      Error: ${step.error}`);
            }
            const inner = (step.output as { steps?: Array<{ id: string; type: string; status: string; durationMs: number; costUsd?: number; error?: string; continueOnFailure?: boolean }> } | null)?.steps ?? [];
            for (const childStep of inner) {
              const childIcon = childStep.status === "failed" && childStep.continueOnFailure ? "⚠" : statusIcon(childStep.status as "success" | "failed" | "skipped");
              const childSuffix = childStep.status === "failed" && childStep.continueOnFailure ? " (continued)" : "";
              const childCost = childStep.costUsd != null ? ` $${childStep.costUsd.toFixed(3)}` : " —";
              console.log(`    ║ ${childIcon} ${childStep.id} [${childStep.type}] ${formatDuration(childStep.durationMs)}${childCost}${childSuffix}`);
              if (childStep.error) {
                console.log(`          Error: ${childStep.error}`);
              }
            }
            continue;
          }

          const repairSummary = extractRepairSummary(step.output);
          const baseCost = step.costUsd ?? null;
          const totalStepCost = baseCost !== null
            ? baseCost + (repairSummary?.totalCostUsd ?? 0)
            : repairSummary?.totalCostUsd ?? null;
          const cost = totalStepCost !== null ? ` $${totalStepCost.toFixed(3)}` : " —";
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
