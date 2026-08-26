import {
  group,
  type KVEntry,
  kvBlock,
  list,
  plain,
  type RenderNode,
  type SemanticRole,
  span,
} from "#modules/rendering/primitives.js";
import type {
  StatusOperationalRun,
  StatusRunProjection,
  StatusRunSandbox,
} from "./status-cli-types.js";

function runRole(run: StatusOperationalRun): SemanticRole {
  switch (run.state) {
    case "queued":
    case "cancelled":
      return "muted";
    case "running":
    case "integrating":
      return "info";
    case "waiting":
      return "warn";
    case "needs_attention":
    case "failed":
      return "error";
    case "succeeded":
      return "success";
  }
}

function recordsValue(records: readonly Record<string, unknown>[]): string {
  return records.length === 0 ? "none" : records.map((record) => JSON.stringify(record)).join("; ");
}

function recordValue(record: Record<string, unknown> | null): string {
  return record === null ? "none" : JSON.stringify(record);
}

function sandboxEntries(sandbox: StatusRunSandbox | null): KVEntry[] {
  if (sandbox === null) {
    return [{ label: "Sandbox", value: "not allocated", role: "muted" }];
  }
  const workspace = sandbox.workspace;
  const head = workspace === null
    ? { value: "not applicable", role: "muted" as const }
    : workspace.available
      ? { value: workspace.headCommit, role: "muted" as const }
      : { value: "unavailable", role: "warn" as const };
  const dirty = workspace === null
    ? { value: "not applicable", role: "muted" as const }
    : {
        value: workspace.dirtySummary,
        role: workspace.available && !workspace.dirty ? "muted" as const : "warn" as const,
      };
  return [
    { label: "Repository", value: sandbox.repository, role: "muted" },
    { label: "Branch", value: sandbox.branch ?? "none", role: "muted" },
    { label: "Base", value: sandbox.baseCommit ?? "none", role: "muted" },
    { label: "Head", ...head },
    { label: "Dirty", ...dirty },
    { label: "Sandbox", value: sandbox.rootDir, role: "muted" },
    { label: "Workspace", value: sandbox.workspaceDir, role: "muted" },
    { label: "Temp", value: sandbox.tempDir, role: "muted" },
    { label: "Artifacts", value: sandbox.artifactDir, role: "muted" },
  ];
}

function runEntries(run: StatusOperationalRun): KVEntry[] {
  return [
    {
      label: "Resources",
      value: run.resources.length === 0 ? "none" : run.resources.join(", "),
      role: run.resources.length === 0 ? "muted" : "info",
    },
    {
      label: "Processes",
      value: recordsValue(run.processes),
      role: run.processes.length === 0 ? "muted" : "info",
    },
    ...sandboxEntries(run.sandbox),
    {
      label: "Wait",
      value: recordValue(run.wait),
      role: run.wait === null ? "muted" : "warn",
    },
    {
      label: "Last error",
      value: run.lastError ?? "none",
      role: run.lastError === null ? "muted" : "error",
    },
  ];
}

export function buildRunSandboxStatusNode(projection: StatusRunProjection): RenderNode | null {
  if (!projection.available) {
    return group(
      "Run sandboxes",
      kvBlock([
        {
          label: "Projection",
          value: `unavailable  (${projection.databasePath})`,
          role: "warn",
        },
      ]),
    );
  }
  if (projection.runs.length === 0) return null;
  return group(
    "Run sandboxes",
    list(
      projection.runs.map((run) => ({
        spans: [
          span(run.state, runRole(run), true),
          plain(`  ${run.workflow}  ${run.runId}`),
        ],
        children: [kvBlock(runEntries(run))],
      })),
    ),
  );
}
