import type { UiListItem, UiRole } from "./operator-ui-types.js";
import type { StatusOperationalRun, StatusSnapshot } from "./status-cli.js";

function runRole(run: StatusOperationalRun): UiRole {
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

function runDetail(run: StatusOperationalRun): string {
  const sandbox = run.sandbox;
  const sandboxDetails = sandbox === null
    ? ["sandbox not allocated"]
    : [
        `repository ${sandbox.repository}`,
        `branch ${sandbox.branch ?? "none"}`,
        `base ${sandbox.baseCommit ?? "none"}`,
        `head ${
          sandbox.workspace === null
            ? "not applicable"
            : sandbox.workspace.headCommit ?? "unavailable"
        }`,
        `dirty ${sandbox.workspace?.dirtySummary ?? "not applicable"}`,
        `workspace ${sandbox.workspaceDir}`,
      ];
  return [
    `resources ${run.resources.length === 0 ? "none" : run.resources.join(", ")}`,
    `processes ${recordsValue(run.processes)}`,
    ...sandboxDetails,
    `wait ${run.wait === null ? "none" : JSON.stringify(run.wait)}`,
    `error ${run.lastError ?? "none"}`,
  ].join(" · ");
}

export function statusRunSandboxItems(snapshot: StatusSnapshot): UiListItem[] {
  if (!snapshot.runProjection.available) {
    return [{
      id: "run-projection-unavailable",
      title: "Run projection unavailable",
      detail: snapshot.runProjection.databasePath,
      role: "warn",
    }];
  }
  return snapshot.runProjection.runs.map((run) => ({
    id: run.runId,
    title: `${run.state}: ${run.workflow}`,
    detail: runDetail(run),
    role: runRole(run),
  }));
}
