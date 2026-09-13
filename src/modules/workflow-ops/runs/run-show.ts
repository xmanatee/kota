import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import type { WorkflowRunDetail } from "#core/daemon/daemon-control.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type {
  WorkflowDeliveryDisposition,
  WorkflowStepSkipReason,
} from "#core/workflow/run-types.js";
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
import {
  requireWorkflowRunDurableAuthority,
  workflowRunStoreWithDurableAuthority,
} from "./workflow-history.js";

export function formatSkipReason(reason: WorkflowStepSkipReason): string {
  return reason.label ? `${reason.kind}:${reason.label}` : reason.kind;
}

export function formatWarningsSection(warnings: Array<{ type: string; message: string }>): string[] {
  return warnings.map((w) => `  [${w.type}] ${w.message}`);
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

function formatDeliveryDisposition(delivery: WorkflowDeliveryDisposition): { text: string; role: SemanticRole } {
  switch (delivery.kind) {
    case "completed":
      return { text: `✓ completed (${delivery.taskId ?? "task"})`, role: "success" };
    case "blocked":
      return {
        text: `⊘ blocked (${delivery.taskId ?? "task"}${delivery.blocker ? `: ${delivery.blocker}` : ""})`,
        role: "warn",
      };
    case "dropped":
      return { text: `✕ dropped (${delivery.taskId ?? "task"})`, role: "muted" };
    case "failed":
      return { text: `✕ failed${delivery.reason ? `: ${delivery.reason}` : ""}`, role: "error" };
    case "needs_attention":
      return { text: `! needs_attention${delivery.reason ? `: ${delivery.reason}` : ""}`, role: "warn" };
    case "cancelled":
      return { text: "— cancelled", role: "warn" };
    case "unresolved":
      return { text: `? unresolved${delivery.reason ? `: ${delivery.reason}` : ""}`, role: "warn" };
    case "not_applicable":
      return { text: "— not-applicable", role: "muted" };
  }
}

function buildRunHeader(
  run: WorkflowRunDetail,
  showPayload: boolean,
): RenderNode {
  const deliveryInfo = run.delivery === undefined
    ? { text: "— unavailable", role: "muted" as const }
    : formatDeliveryDisposition(run.delivery);
  const continuation = run.continuation;
  const entries: KVEntry[] = [
    { label: "Run", value: run.id, role: "accent" },
    { label: "Workflow", value: run.workflow },
    {
      label: "Status",
      value: `${statusIcon(run.status)} ${run.status}`,
      role: chainNodeRole(run.status),
    },
    {
      label: "Delivery",
      value: deliveryInfo.text,
      role: deliveryInfo.role,
    },
  ];
  if (run.retryOf) entries.push({ label: "Retry of", value: run.retryOf, role: "muted" });
  if (run.resumedFromRunId) {
    entries.push({ label: "Resumed from", value: run.resumedFromRunId, role: "muted" });
  }
  entries.push({ label: "Trigger", value: run.triggerEvent });
  if (run.tags && run.tags.length > 0) {
    entries.push({ label: "Tags", value: run.tags.join(", "), role: "muted" });
  }
  entries.push({ label: "Started", value: new Date(run.startedAt).toLocaleString(), role: "muted" });
  if (run.completedAt) {
    entries.push({ label: "Finished", value: new Date(run.completedAt).toLocaleString(), role: "muted" });
  }
  if (run.durationMs != null) {
    entries.push({ label: "Duration", value: formatDuration(run.durationMs) });
  }
  if (run.usage !== undefined) {
    entries.push({
      label: "Cost",
      value: formatUsageCost(run.usage),
      role: "muted",
    });
  }
  if (continuation !== undefined) {
    entries.push(
      { label: "Continuation", value: continuation.decision, role: "warn" },
      { label: "Why", value: continuation.rationale },
      { label: "Next", value: continuation.nextAction },
      {
        label: "Boundary",
        value: continuation.boundaries.join(", "),
        role: "muted",
      },
    );
  }
  const nodes: RenderNode[] = [kvBlock(entries)];
  if (
    showPayload &&
    run.triggerPayload &&
    Object.keys(run.triggerPayload).length > 0
  ) {
    nodes.push(json(run.triggerPayload, "Payload:"));
  }
  return stack(...nodes);
}

function buildStepSpans(step: WorkflowRunDetail["steps"][number]): {
  header: LineNode;
  detail: LineNode[];
} {
  const dur = formatDuration(step.durationMs);
  const cost = step.type === "parallel" ? "" : step.usage === undefined ? " —" : ` ${formatUsageCost(step.usage)}`;
  const header = line(plain(`  ${statusIcon(step.status)} ${step.id} [${step.type}] ${dur}${cost}`));
  const detail: LineNode[] = [];
  if (step.error) detail.push(line(plain(`      Error: ${step.error}`)));
  if (step.status === "skipped" && step.skipReason) {
    detail.push(line(plain(`      Skipped: ${formatSkipReason(step.skipReason)}`)));
  }
  return { header, detail };
}

function errorSpans(message: string): TextSpan[] {
  return [span(message, "error")];
}

function formatUsageCost(usage: NonNullable<WorkflowRunDetail["usage"]>): string {
  return usage.cost.state === "complete"
    ? `$${usage.cost.usd.toFixed(4)}`
    : usage.cost.state;
}

export function registerRunShowCommand(
  wfCmd: Command,
  ctx: { cwd: ModuleContext["cwd"]; client: Pick<ModuleContext["client"], "workflow"> },
): void {
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
      const status = await ctx.client.workflow.status();
      const store = workflowRunStoreWithDurableAuthority(
        ctx.cwd,
        requireWorkflowRunDurableAuthority(
          status.authorityCriticalRunIds,
          status.operationallyActiveRunIds,
          status.terminalRunIds,
        ),
      );

      let resolvedId = runId;
      if (!runId.includes("Z-")) {
        const match = store.resolveRunIdPrefix(runId);
        if (!match) {
          print(line(...errorSpans(`Run "${runId}" not found.`)));
          process.exit(1);
        }
        resolvedId = match;
      }

      // The contract `getRun` returns the daemon's live view when daemon-up
      // and reconstructs `WorkflowRunDetail` from the artifact when daemon-
      // down, so the CLI does not branch on daemon presence here. `--step`
      // needs the full step output (including the `output` field, which the
      // daemon summary trims) so that path always reads the artifact.
      if (stepId !== undefined) {
        const metadata = store.getRun(resolvedId);
        if (!metadata) {
          print(line(...errorSpans(`Run "${resolvedId}" not found.`)));
          process.exit(1);
        }
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

      const result = await ctx.client.workflow.getRun(resolvedId);
      if (!result.found) {
        print(line(...errorSpans(`Run "${resolvedId}" not found.`)));
        process.exit(1);
      }
      const run = result.run;

      if (showChain) {
        // Walk up causedBy chain to find the highest reachable ancestor
        const MAX_DEPTH = 5;
        let rootId = resolvedId;
        let current: { causedBy?: { runId: string; workflow: string } } | null = run;
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

      const children: RenderNode[] = [
        buildRunHeader(run, showPayload === true),
      ];
      if (errorText !== null) {
        children.push(blank());
        children.push(line(plain("Error:")));
        for (const errorLine of errorText.split("\n")) {
          children.push(line(plain(errorLine)));
        }
      }
      if (run.warnings && run.warnings.length > 0) {
        children.push(blank());
        children.push(line(plain("Warnings:")));
        for (const warningLine of formatWarningsSection(run.warnings)) {
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

      if (run.steps.length > 0) {
        children.push(blank());
        children.push(line(plain(`Steps (${run.steps.length}):`)));
        for (const step of run.steps) {
          const { header, detail } = buildStepSpans(step);
          children.push(header);
          for (const d of detail) children.push(d);
        }
      }

      print(stack(...children));
    });
}
