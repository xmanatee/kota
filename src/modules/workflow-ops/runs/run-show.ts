import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { RepairSummary } from "#core/workflow/run-store-helpers.js";
import { extractRepairSummary } from "#core/workflow/run-store-helpers.js";
import type { WorkflowRunMetadata, WorkflowStepSkipReason } from "#core/workflow/run-types.js";
import {
  blank,
  json,
  type LineNode,
  line,
  plain,
  type RenderNode,
  span,
  stack,
  type TextSpan,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { formatDuration, statusIcon } from "../utils.js";

export function formatSkipReason(reason: WorkflowStepSkipReason): string {
  return reason.label ? `${reason.kind}:${reason.label}` : reason.kind;
}

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

export function buildChainLines(
  node: ChainNode,
  currentId: string,
  prefix: string,
  isLast: boolean,
  isRoot: boolean,
): LineNode[] {
  const connector = isRoot ? "" : isLast ? "└─ " : "├─ ";
  const dur = node.durationMs != null ? ` (${formatDuration(node.durationMs)})` : "";
  const marker = node.id === currentId ? " ← current" : "";
  const icon = statusIcon(node.status);
  const lines: LineNode[] = [
    line(plain(`${prefix}${connector}${icon} ${node.workflow}/${node.id}${dur}${marker}`)),
  ];
  const childPrefix = isRoot ? prefix : prefix + (isLast ? "   " : "│  ");
  for (let i = 0; i < node.children.length; i++) {
    lines.push(
      ...buildChainLines(
        node.children[i]!,
        currentId,
        childPrefix,
        i === node.children.length - 1,
        false,
      ),
    );
  }
  return lines;
}

export function printChainTree(
  node: ChainNode,
  currentId: string,
  prefix: string,
  isLast: boolean,
  isRoot: boolean,
): void {
  print(stack(...buildChainLines(node, currentId, prefix, isLast, isRoot)));
}

function labeledKVLine(label: string, value: string, labelWidth: number): LineNode {
  return line(plain(`${`${label}:`.padEnd(labelWidth)} ${value}`));
}

function buildRunHeader(metadata: WorkflowRunMetadata, showPayload: boolean): RenderNode {
  const labelWidth = 9;
  const lines: LineNode[] = [
    line(plain(`Run:      ${metadata.id}`)),
    line(plain(`Workflow: ${metadata.workflow}`)),
    line(plain("Status:   "), plain(`${statusIcon(metadata.status)} ${metadata.status}`)),
  ];
  if (metadata.retryOf) lines.push(line(plain(`Retry of: ${metadata.retryOf}`)));
  if (metadata.resumedFromRunId) {
    lines.push(labeledKVLine("Resumed from", metadata.resumedFromRunId, labelWidth));
  }
  lines.push(line(plain(`Trigger:  ${metadata.trigger.event}`)));
  if (metadata.tags && metadata.tags.length > 0) {
    lines.push(line(plain(`Tags:     ${metadata.tags.join(", ")}`)));
  }
  lines.push(line(plain(`Started:  ${new Date(metadata.startedAt).toLocaleString()}`)));
  if (metadata.completedAt) {
    lines.push(line(plain(`Finished: ${new Date(metadata.completedAt).toLocaleString()}`)));
  }
  if (metadata.durationMs != null) {
    lines.push(line(plain(`Duration: ${formatDuration(metadata.durationMs)}`)));
  }
  if (metadata.totalCostUsd != null) {
    lines.push(line(plain(`Cost:     $${metadata.totalCostUsd.toFixed(4)}`)));
  }
  const nodes: RenderNode[] = [...lines];
  if (
    showPayload &&
    metadata.trigger.payload &&
    Object.keys(metadata.trigger.payload).length > 0
  ) {
    nodes.push(json(metadata.trigger.payload, "Payload:"));
  }
  return stack(...nodes);
}

function buildStepSpans(step: WorkflowRunMetadata["steps"][number]): {
  header: LineNode;
  detail: LineNode[];
} {
  const dur = formatDuration(step.durationMs);
  const iconStr =
    step.status === "failed" && step.continueOnFailure ? "⚠" : statusIcon(step.status);
  const reusedSuffix = (step as { reused?: boolean }).reused ? " (reused)" : "";
  const suffix =
    step.status === "failed" && step.continueOnFailure ? " (continued)" : reusedSuffix;
  const detail: LineNode[] = [];

  if (step.type === "parallel") {
    const header = line(plain(`  ${iconStr} ${step.id} [parallel] ${dur}${suffix}`));
    if (step.error) detail.push(line(plain(`      Error: ${step.error}`)));
    if (step.status === "skipped" && step.skipReason) {
      detail.push(line(plain(`      Skipped: ${formatSkipReason(step.skipReason)}`)));
    }
    const inner = (step.output as {
      steps?: Array<{
        id: string;
        type: string;
        status: string;
        durationMs: number;
        costUsd?: number;
        error?: string;
        continueOnFailure?: boolean;
      }>;
    } | null)?.steps ?? [];
    for (const childStep of inner) {
      const childIcon =
        childStep.status === "failed" && childStep.continueOnFailure
          ? "⚠"
          : statusIcon(childStep.status);
      const childSuffix =
        childStep.status === "failed" && childStep.continueOnFailure ? " (continued)" : "";
      const childCost = childStep.costUsd != null ? ` $${childStep.costUsd.toFixed(3)}` : " —";
      detail.push(
        line(
          plain(
            `    ║ ${childIcon} ${childStep.id} [${childStep.type}] ${formatDuration(childStep.durationMs)}${childCost}${childSuffix}`,
          ),
        ),
      );
      if (childStep.error) {
        detail.push(line(plain(`          Error: ${childStep.error}`)));
      }
    }
    return { header, detail };
  }

  const repairSummary = extractRepairSummary(step.output);
  const baseCost = step.costUsd ?? null;
  const totalStepCost =
    baseCost !== null
      ? baseCost + (repairSummary?.totalCostUsd ?? 0)
      : (repairSummary?.totalCostUsd ?? null);
  const cost = totalStepCost !== null ? ` $${totalStepCost.toFixed(3)}` : " —";
  const header = line(plain(`  ${iconStr} ${step.id} [${step.type}] ${dur}${cost}${suffix}`));
  if (step.error) detail.push(line(plain(`      Error: ${step.error}`)));
  if (step.status === "skipped" && step.skipReason) {
    detail.push(line(plain(`      Skipped: ${formatSkipReason(step.skipReason)}`)));
  }
  if (repairSummary) detail.push(line(plain(`      ${formatRepairLine(repairSummary)}`)));
  if (step.output !== undefined && step.output !== null) {
    const outputSummary = JSON.stringify(step.output);
    const trimmed =
      outputSummary.length > 120 ? `${outputSummary.slice(0, 120)}…` : outputSummary;
    detail.push(line(plain(`      Output: ${trimmed}`)));
  }
  return { header, detail };
}

function errorSpans(message: string): TextSpan[] {
  return [span(message, "error")];
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
            print(line(...errorSpans(`Run "${runId}" not found.`)));
            process.exit(1);
          }
          resolvedId = match;
        } catch {
          print(line(...errorSpans(`Run "${runId}" not found.`)));
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
            ...(s.skipReason !== undefined && { skipReason: s.skipReason }),
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
          print(line(...errorSpans(`Run "${resolvedId}" not found.`)));
          process.exit(1);
        }
        metadata = diskMeta;
      }

      if (stepId !== undefined) {
        const step = metadata.steps.find((s) => s.id === stepId);
        if (!step) {
          print(line(...errorSpans(`Step "${stepId}" not found in run "${resolvedId}".`)));
          process.exit(1);
        }
        if (step.error) {
          print(line(plain(step.error)));
        } else {
          print(json(step.output));
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
          print(line(...errorSpans(`Could not load chain for run "${resolvedId}".`)));
          process.exit(1);
        }
        printChainTree(tree, resolvedId, "", true, true);
        return;
      }

      const errorPath = join(store.runsDir, resolvedId, "error.txt");
      const errorText = existsSync(errorPath) ? readFileSync(errorPath, "utf-8") : null;

      const children: RenderNode[] = [buildRunHeader(metadata, showPayload === true)];
      if (errorText !== null) {
        children.push(blank());
        children.push(line(plain("Error:")));
        for (const errorLine of errorText.split("\n")) {
          children.push(line(plain(errorLine)));
        }
      }
      if (metadata.warnings && metadata.warnings.length > 0) {
        children.push(blank());
        children.push(line(plain("Warnings:")));
        for (const warningLine of formatWarningsSection(metadata.warnings)) {
          children.push(line(plain(warningLine)));
        }
      }

      // Show downstream runs triggered by this run
      let triggeredRuns: { id: string; workflow: string; status: string }[] = [];
      if (daemonRun) {
        const downstreamResult = daemonClient
          ? await daemonClient.listWorkflowRuns(undefined, 50, undefined, resolvedId)
          : null;
        if (downstreamResult) {
          triggeredRuns = downstreamResult.runs.map((r) => ({
            id: r.id,
            workflow: r.workflow,
            status: r.status,
          }));
        }
      } else {
        triggeredRuns = store
          .listRuns({ causedByRunId: resolvedId, limit: 50 })
          .map((r) => ({ id: r.id, workflow: r.workflow, status: r.status }));
      }
      if (triggeredRuns.length > 0) {
        children.push(blank());
        children.push(line(plain(`Triggered runs (${triggeredRuns.length}):`)));
        for (const r of triggeredRuns) {
          children.push(line(plain(`  ${statusIcon(r.status)} ${r.id} [${r.workflow}]`)));
        }
      }

      if (metadata.steps.length > 0) {
        children.push(blank());
        children.push(line(plain(`Steps (${metadata.steps.length}):`)));
        for (const step of metadata.steps) {
          const { header, detail } = buildStepSpans(step);
          children.push(header);
          for (const d of detail) children.push(d);
        }
      }

      print(stack(...children));
    });
}
