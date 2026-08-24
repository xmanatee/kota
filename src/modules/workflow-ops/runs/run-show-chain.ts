import {
  group,
  line,
  plain,
  type RenderNode,
  type SemanticRole,
  stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import type { WorkflowClient } from "../client.js";
import { formatDuration, statusIcon } from "../utils.js";

export type ChainNode = {
  id: string;
  workflow: string;
  status: string;
  durationMs?: number;
  children: ChainNode[];
};

export async function fetchRunSummary(
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
  return result.runs.map((run) => ({
    id: run.id,
    workflow: run.workflow,
    status: run.status,
    ...(run.durationMs !== undefined && { durationMs: run.durationMs }),
  }));
}

export async function buildChainTree(
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

export function runStatusRole(status: string): SemanticRole {
  switch (status) {
    case "success":
      return "success";
    case "failed":
      return "error";
    case "yielded":
    case "interrupted":
    case "completed-with-warnings":
      return "warn";
    case "running":
      return "info";
    default:
      return "muted";
  }
}

function chainRowLabel(node: ChainNode, currentId: string, connector: string): string {
  const duration = node.durationMs != null ? ` (${formatDuration(node.durationMs)})` : "";
  const marker = node.id === currentId ? " ← current" : "";
  return `${connector}${statusIcon(node.status)} ${node.workflow}/${node.id}${duration}${marker}`;
}

function buildChainChildEntry(
  node: ChainNode,
  currentId: string,
  isLast: boolean,
): RenderNode {
  const label = chainRowLabel(node, currentId, isLast ? "└─ " : "├─ ");
  if (node.children.length === 0) return line(plain(label));
  return group(
    label,
    stack(...node.children.map((child, index) =>
      buildChainChildEntry(child, currentId, index === node.children.length - 1)
    )),
    runStatusRole(node.status),
  );
}

export function buildChainNode(node: ChainNode, currentId: string): RenderNode {
  const rootLabel = chainRowLabel(node, currentId, "");
  if (node.children.length === 0) return line(plain(rootLabel));
  return group(
    rootLabel,
    stack(...node.children.map((child, index) =>
      buildChainChildEntry(child, currentId, index === node.children.length - 1)
    )),
    runStatusRole(node.status),
  );
}

export function printChainTree(node: ChainNode, currentId: string): void {
  print(buildChainNode(node, currentId));
}
