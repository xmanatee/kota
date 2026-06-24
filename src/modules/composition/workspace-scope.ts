import type { ToolRunnerContext } from "#core/tools/index.js";
import type { WorkspaceScope, WorkspaceSource } from "./workspace-types.js";

export function processWorkspaceScope(): WorkspaceScope {
  return { kind: "process", key: "process" };
}

export function processWorkspaceSource(context?: ToolRunnerContext): WorkspaceSource {
  if (context?.toolUseId) return { kind: "process", toolUseId: context.toolUseId };
  return { kind: "process" };
}

export function resolveWorkspaceScope(context?: ToolRunnerContext): WorkspaceScope {
  if (context?.workflow) {
    return {
      kind: "workflow",
      key: `workflow:${context.workflow.runId}`,
      workflowName: context.workflow.workflowName,
      runId: context.workflow.runId,
      scopeId: context.workflow.scopeId,
      projectId: context.workflow.projectId,
    };
  }
  if (context?.sessionId) {
    return {
      kind: "session",
      key: `session:${context.sessionId}`,
      sessionId: context.sessionId,
    };
  }
  return processWorkspaceScope();
}

export function workspaceSourceFromContext(context?: ToolRunnerContext): WorkspaceSource {
  if (context?.workflow) {
    const source: WorkspaceSource = {
      kind: "workflow",
      workflowName: context.workflow.workflowName,
      runId: context.workflow.runId,
      stepId: context.workflow.stepId,
      spanId: context.workflow.spanId,
      scopeId: context.workflow.scopeId,
      projectId: context.workflow.projectId,
    };
    if (context.toolUseId) source.toolUseId = context.toolUseId;
    if (context.sessionId) source.sessionId = context.sessionId;
    return source;
  }
  if (context?.sessionId) {
    const source: WorkspaceSource = {
      kind: "session",
      sessionId: context.sessionId,
    };
    if (context.toolUseId) source.toolUseId = context.toolUseId;
    return source;
  }
  return processWorkspaceSource(context);
}

export function workspaceSourceLabel(source: WorkspaceSource): string {
  if (source.kind === "workflow") {
    return `${source.workflowName}/${source.stepId}`;
  }
  if (source.kind === "session") return source.sessionId;
  return "process";
}
