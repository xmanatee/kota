import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";
import type { ToolResult } from "#core/tools/index.js";
import {
  type McpCreateTaskResult,
  type McpGetTaskResult,
  type McpProtocolVersion,
  McpToolError,
} from "./client.js";
import type { PersistedRemoteMcpTaskHandle } from "./remote-task-store.js";

export type McpRemoteTaskStats = {
  protocolVersion: McpProtocolVersion;
  toolDeclarationFingerprint: string;
  pollCount: number;
  inputUpdateCount: number;
  startedAtMs: number;
  deadlineAtMs: number | null;
};

export type McpRemoteTaskResumeResult =
  | {
      kind: "result";
      serverConfigName: string;
      serverDisplayName: string;
      tool: string;
      taskId: string;
      result: ToolResult;
    }
  | {
      kind: "diagnostic";
      serverConfigName: string;
      serverDisplayName: string;
      tool: string;
      taskId: string;
      message: string;
    };

type RemoteTaskDiagnosticEntry = {
  client: { getName(): string };
  originalName: string;
};

function remoteTaskDiagnostics(
  entry: RemoteTaskDiagnosticEntry,
  task: McpCreateTaskResult | McpGetTaskResult,
  stats: McpRemoteTaskStats,
): KotaJsonObject {
  return {
    resultType: "task",
    protocolVersion: stats.protocolVersion,
    server: entry.client.getName(),
    tool: entry.originalName,
    toolDeclarationFingerprint: stats.toolDeclarationFingerprint,
    taskId: task.taskId,
    status: task.status,
    pollCount: stats.pollCount,
    inputUpdateCount: stats.inputUpdateCount,
    startedAt: new Date(stats.startedAtMs).toISOString(),
    deadlineAt: stats.deadlineAtMs === null ? null : new Date(stats.deadlineAtMs).toISOString(),
    lastUpdatedAt: task.lastUpdatedAt,
  };
}

export function withRemoteTaskDiagnostics(
  result: ToolResult,
  entry: RemoteTaskDiagnosticEntry,
  task: McpCreateTaskResult | McpGetTaskResult,
  stats: McpRemoteTaskStats,
): ToolResult {
  return {
    ...result,
    _meta: {
      ...(result._meta ?? {}),
      mcpTask: remoteTaskDiagnostics(entry, task, stats),
    },
  };
}

export function remoteTaskErrorResult(
  entry: RemoteTaskDiagnosticEntry,
  task: McpCreateTaskResult | McpGetTaskResult,
  stats: McpRemoteTaskStats,
  reason: string,
  errorCode?: number,
): ToolResult {
  return withRemoteTaskDiagnostics(
    {
      content:
        `MCP tool error: remote MCP task "${task.taskId}" for tool ` +
        `"${entry.originalName}" on server "${entry.client.getName()}" ${reason}`,
      is_error: true,
      ...(errorCode !== undefined ? { structuredContent: { errorCode } } : {}),
    },
    entry,
    task,
    stats,
  );
}

export function remoteTaskStatsForPersistedHandle(
  handle: PersistedRemoteMcpTaskHandle,
): McpRemoteTaskStats {
  return {
    protocolVersion: handle.protocolVersion,
    toolDeclarationFingerprint: handle.toolDeclarationFingerprint ?? handle.serverFingerprint,
    pollCount: handle.pollCount,
    inputUpdateCount: handle.inputUpdateCount,
    startedAtMs: Date.parse(handle.startedAt),
    deadlineAtMs: handle.deadlineAt === null ? null : Date.parse(handle.deadlineAt),
  };
}

export function formatRemoteTaskResumeResult(result: McpRemoteTaskResumeResult): string {
  const prefix =
    `[kota] MCP remote task "${result.taskId}" for tool "${result.tool}" ` +
    `on server "${result.serverDisplayName}"`;
  if (result.kind === "diagnostic") {
    return `${prefix} was not resumed: ${result.message}`;
  }
  const state = result.result.is_error ? "resumed with error" : "resumed";
  return `${prefix} ${state}: ${truncateRemoteTaskResumeContent(result.result.content)}`;
}

function truncateRemoteTaskResumeContent(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= 300) return normalized;
  return `${normalized.slice(0, 297)}...`;
}

export function remoteTaskPollingErrorMessage(err: Error): string {
  if (err instanceof McpToolError) return err.message;
  return `MCP remote task polling error: ${err.message}`;
}
