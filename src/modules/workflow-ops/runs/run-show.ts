import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import type { WorkflowRunDetail } from "#core/daemon/daemon-control.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { RepairSummary } from "#core/workflow/run-store-snapshot.js";
import { extractRepairSummary } from "#core/workflow/run-store-snapshot.js";
import type { WorkflowRunMetadata, WorkflowStepSkipReason } from "#core/workflow/run-types.js";
import {
  blank,
  group,
  json,
  type KVEntry,
  kvBlock,
  type LineNode,
  line,
  plain,
  type RenderNode,
  type SemanticRole,
  span,
  stack,
  type TextSpan,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import type { WorkflowClient } from "../client.js";
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
  workflowClient: WorkflowClient,
  id: string,
): Promise<{ id: string; workflow: string; status: string; durationMs?: number; causedBy?: { runId: string; workflow: string } } | null> {
  const result = await workflowClient.getRun(id);
  if (!result.found) return null;
  const run = result.run;
  return {
    id: run.id,
    workflow: run.workflow,
    status: run.status,
    ...(run.durationMs !== undefined && { durationMs: run.durationMs }),
    ...(run.causedBy !== undefined && { causedBy: run.causedBy }),
  };
}

async function fetchChildren(
  workflowClient: WorkflowClient,
  parentId: string,
): Promise<Array<{ id: string; workflow: string; status: string; durationMs?: number }>> {
  const result = await workflowClient.listRuns({ causedByRunId: parentId, limit: 50 });
  return result.runs.map((r) => ({
    id: r.id,
    workflow: r.workflow,
    status: r.status,
    ...(r.durationMs !== undefined && { durationMs: r.durationMs }),
  }));
}

async function buildChainTree(
  rootId: string,
  workflowClient: WorkflowClient,
  depth: number,
  maxDepth: number,
): Promise<ChainNode | null> {
  const run = await fetchRunSummary(workflowClient, rootId);
  if (!run) return null;
  const node: ChainNode = {
    id: run.id,
    workflow: run.workflow,
    status: run.status,
    ...(run.durationMs !== undefined && { durationMs: run.durationMs }),
    children: [],
  };
  if (depth < maxDepth) {
    const children = await fetchChildren(workflowClient, rootId);
    for (const child of children) {
      const childNode = await buildChainTree(child.id, workflowClient, depth + 1, maxDepth);
      if (childNode) node.children.push(childNode);
    }
  }
  return node;
}

function chainNodeRole(status: string): SemanticRole {
  switch (status) {
    case "success":
      return "success";
    case "failed":
      return "error";
    case "interrupted":
      return "warn";
    case "completed-with-warnings":
      return "warn";
    case "running":
      return "info";
    default:
      return "muted";
  }
}

function chainRowLabel(node: ChainNode, currentId: string, connector: string): string {
  const dur = node.durationMs != null ? ` (${formatDuration(node.durationMs)})` : "";
  const marker = node.id === currentId ? " ← current" : "";
  const icon = statusIcon(node.status);
  return `${connector}${icon} ${node.workflow}/${node.id}${dur}${marker}`;
}

function buildChainChildEntry(
  node: ChainNode,
  currentId: string,
  isLast: boolean,
): RenderNode {
  const connector = isLast ? "└─ " : "├─ ";
  const label = chainRowLabel(node, currentId, connector);
  if (node.children.length === 0) return line(plain(label));
  return group(
    label,
    stack(
      ...node.children.map((c, i) =>
        buildChainChildEntry(c, currentId, i === node.children.length - 1),
      ),
    ),
    chainNodeRole(node.status),
  );
}

export function buildChainNode(node: ChainNode, currentId: string): RenderNode {
  const rootLabel = chainRowLabel(node, currentId, "");
  if (node.children.length === 0) return line(plain(rootLabel));
  return group(
    rootLabel,
    stack(
      ...node.children.map((c, i) =>
        buildChainChildEntry(c, currentId, i === node.children.length - 1),
      ),
    ),
    chainNodeRole(node.status),
  );
}

export function printChainTree(node: ChainNode, currentId: string): void {
  print(buildChainNode(node, currentId));
}

function buildRunHeader(metadata: WorkflowRunMetadata, showPayload: boolean): RenderNode {
  const entries: KVEntry[] = [
    { label: "Run", value: metadata.id, role: "accent" },
    { label: "Workflow", value: metadata.workflow },
    {
      label: "Status",
      value: `${statusIcon(metadata.status)} ${metadata.status}`,
      role: chainNodeRole(metadata.status),
    },
  ];
  if (metadata.retryOf) entries.push({ label: "Retry of", value: metadata.retryOf, role: "muted" });
  if (metadata.resumedFromRunId) {
    entries.push({ label: "Resumed from", value: metadata.resumedFromRunId, role: "muted" });
  }
  entries.push({ label: "Trigger", value: metadata.trigger.event });
  if (metadata.tags && metadata.tags.length > 0) {
    entries.push({ label: "Tags", value: metadata.tags.join(", "), role: "muted" });
  }
  entries.push({ label: "Started", value: new Date(metadata.startedAt).toLocaleString(), role: "muted" });
  if (metadata.completedAt) {
    entries.push({ label: "Finished", value: new Date(metadata.completedAt).toLocaleString(), role: "muted" });
  }
  if (metadata.durationMs != null) {
    entries.push({ label: "Duration", value: formatDuration(metadata.durationMs) });
  }
  if (metadata.totalCostUsd != null) {
    entries.push({
      label: "Cost",
      value: `$${metadata.totalCostUsd.toFixed(4)}`,
      role: "muted",
    });
  }
  const nodes: RenderNode[] = [kvBlock(entries)];
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
  if (step.type === "agent" && (step.harness || step.model)) {
    const parts: string[] = [];
    if (step.harness) parts.push(step.harness);
    if (step.model) parts.push(step.model);
    detail.push(line(plain(`      Harness: ${parts.join(" / ")}`)));
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

/**
 * Project a daemon `WorkflowRunDetail` onto the `WorkflowRunMetadata` shape
 * that the local rendering helpers consume. The two representations overlap
 * in everything the CLI shows; daemon-only fields like step `startedAt` /
 * `completedAt` come from the run start time as a best-effort placeholder.
 */
function metadataFromDetail(run: WorkflowRunDetail): WorkflowRunMetadata {
  return {
    id: run.id,
    workflow: run.workflow,
    definitionPath: "",
    trigger: {
      event: run.triggerEvent,
      schemaRef: run.triggerSchemaRef,
      payload: run.triggerPayload ?? {},
    },
    startedAt: run.startedAt,
    status: run.status as WorkflowRunMetadata["status"],
    runDir: "",
    steps: run.steps.map((s) => ({
      id: s.id,
      type: s.type as WorkflowRunMetadata["steps"][number]["type"],
      status: s.status as "success" | "failed" | "skipped",
      startedAt: run.startedAt,
      completedAt: run.completedAt ?? run.startedAt,
      durationMs: s.durationMs,
      ...(s.error !== undefined && { error: s.error }),
      ...(s.costUsd != null && { costUsd: s.costUsd, output: { totalCostUsd: s.costUsd } }),
      ...(s.skipReason !== undefined && { skipReason: s.skipReason }),
    })),
    ...(run.completedAt != null && { completedAt: run.completedAt }),
    ...(run.durationMs != null && { durationMs: run.durationMs }),
    ...(run.totalCostUsd != null && { totalCostUsd: run.totalCostUsd }),
    ...(run.triggeredByRunId != null && { triggeredByRunId: run.triggeredByRunId }),
    ...(run.causedBy != null && { causedBy: run.causedBy }),
    ...(run.retryOf != null && { retryOf: run.retryOf }),
    ...(run.resumedFromRunId != null && { resumedFromRunId: run.resumedFromRunId }),
    ...(run.warnings && run.warnings.length > 0 && { warnings: run.warnings }),
  };
}

export function registerRunShowCommand(wfCmd: Command, ctx: ModuleContext): void {
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

      // Run-id prefix matching reads the on-disk runs directory; the contract
      // only takes fully-qualified ids and would have to round-trip through
      // listRuns + filter for the same effect.
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

      // The contract `getRun` returns the daemon's live view when daemon-up
      // and reconstructs `WorkflowRunDetail` from the artifact when daemon-
      // down, so the CLI does not branch on daemon presence here. `--step`
      // needs the full step output (including the `output` field, which the
      // daemon summary trims) so that path always reads the artifact.
      let metadata: WorkflowRunMetadata;
      if (stepId !== undefined) {
        const diskMeta = store.getRun(resolvedId);
        if (!diskMeta) {
          print(line(...errorSpans(`Run "${resolvedId}" not found.`)));
          process.exit(1);
        }
        metadata = diskMeta;
      } else {
        const result = await ctx.client.workflow.getRun(resolvedId);
        if (!result.found) {
          print(line(...errorSpans(`Run "${resolvedId}" not found.`)));
          process.exit(1);
        }
        metadata = metadataFromDetail(result.run);
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
          const parent = await fetchRunSummary(ctx.client.workflow, current.causedBy.runId);
          if (!parent) break;
          rootId = parent.id;
          current = parent;
          depth++;
        }
        const tree = await buildChainTree(rootId, ctx.client.workflow, 0, MAX_DEPTH);
        if (!tree) {
          print(line(...errorSpans(`Could not load chain for run "${resolvedId}".`)));
          process.exit(1);
        }
        printChainTree(tree, resolvedId);
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

      // Show downstream runs triggered by this run via the contract; daemon-
      // up returns the daemon's live tracker, daemon-down enumerates run
      // artifacts.
      const downstream = await ctx.client.workflow.listRuns({
        causedByRunId: resolvedId,
        limit: 50,
      });
      const triggeredRuns = downstream.runs.map((r) => ({
        id: r.id,
        workflow: r.workflow,
        status: r.status,
      }));
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
