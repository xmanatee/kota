import { printTerminalDiagnostic } from "#core/modules/terminal-renderer.js";
import type { ToolResult } from "#core/tools/index.js";
import {
  type McpClient,
  type McpCreateTaskResult,
  type McpGetTaskResult,
  McpToolError,
} from "./client.js";
import { decodeCallToolResult } from "./client-result-decoders.js";
import type { McpExecuteToolOptions } from "./manager-execution-types.js";
import type { McpToolRegistry } from "./manager-tool-registry.js";
import { toToolResult, unsupportedInputRequiredResult } from "./manager-tool-result.js";
import {
  entryForPersistedRemoteTask,
  type McpToolEntry,
} from "./remote-task-entry-resolution.js";
import {
  formatRemoteTaskResumeResult,
  type McpRemoteTaskResumeResult,
  type McpRemoteTaskStats,
  remoteTaskErrorResult,
  remoteTaskPollingErrorMessage,
  remoteTaskStatsForPersistedHandle,
  withRemoteTaskDiagnostics,
} from "./remote-task-results.js";
import type { RemoteMcpServerIdentity } from "./remote-task-server-identity.js";
import {
  type PersistedRemoteMcpTaskHandle,
  type RemoteMcpTaskStore,
  remoteMcpTaskHandleId,
} from "./remote-task-store.js";

const DEFAULT_REMOTE_TASK_POLL_INTERVAL_MS = 1_000;

function sleepUntilNextPoll(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new Error("MCP task polling aborted"));
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("MCP task polling aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Owns resumable remote-task identity, persistence, polling, input, and cancellation. */
export class McpRemoteTaskRuntime {
  private readonly serverIdentities = new Map<string, RemoteMcpServerIdentity>();
  private resumeResults: McpRemoteTaskResumeResult[] = [];

  constructor(
    private readonly store: RemoteMcpTaskStore,
    private readonly registry: McpToolRegistry,
    private readonly clients: ReadonlyMap<string, McpClient>,
  ) {}

  reset(): void {
    this.serverIdentities.clear();
    this.resumeResults = [];
  }

  registerServerIdentity(name: string, identity: RemoteMcpServerIdentity): void {
    this.serverIdentities.set(name, identity);
  }

  getServerIdentity(name: string): RemoteMcpServerIdentity | undefined {
    return this.serverIdentities.get(name);
  }

  getResumeResults(): readonly McpRemoteTaskResumeResult[] {
    return this.resumeResults;
  }

  async resolve(
    entry: McpToolEntry,
    created: McpCreateTaskResult,
    options: McpExecuteToolOptions,
  ): Promise<ToolResult> {
    const now = Date.now();
    const stats: McpRemoteTaskStats = {
      protocolVersion: created.protocolVersion,
      toolDeclarationFingerprint: entry.declaration.fingerprint,
      pollCount: 0,
      inputUpdateCount: 0,
      startedAtMs: now,
      deadlineAtMs: created.ttlMs === null ? null : now + created.ttlMs,
    };
    await this.persist(entry, created, stats);
    return this.poll(entry, created, stats, options);
  }

  async resumePersisted(): Promise<void> {
    for (const handle of await this.store.list()) {
      const result = await this.resume(handle);
      this.resumeResults.push(result);
      printTerminalDiagnostic(formatRemoteTaskResumeResult(result), "warn");
    }
  }

  private async poll(
    entry: McpToolEntry,
    initial: McpCreateTaskResult | McpGetTaskResult,
    stats: McpRemoteTaskStats,
    options: McpExecuteToolOptions,
  ): Promise<ToolResult> {
    let current: McpCreateTaskResult | McpGetTaskResult = initial;
    while (true) {
      if (options.signal?.aborted) {
        return await this.cancelAfterAbort(entry, current, stats);
      }
      if (current.status === "completed") {
        const decoded = decodeCallToolResult(current.result, stats.protocolVersion);
        if (decoded.resultType === "task") {
          await this.clear(entry, current);
          return remoteTaskErrorResult(
            entry,
            current,
            stats,
            "completed with a nested task result",
          );
        }
        await this.clear(entry, current);
        return withRemoteTaskDiagnostics(
          toToolResult(entry, decoded),
          entry,
          current,
          stats,
        );
      }
      if (current.status === "failed") {
        await this.clear(entry, current);
        return remoteTaskErrorResult(entry, current, stats, "failed", current.error?.code);
      }
      if (current.status === "cancelled") {
        await this.clear(entry, current);
        return remoteTaskErrorResult(entry, current, stats, "was cancelled");
      }
      if (stats.deadlineAtMs !== null && Date.now() >= stats.deadlineAtMs) {
        await this.clear(entry, current);
        return remoteTaskErrorResult(
          entry,
          current,
          stats,
          `exceeded its ttlMs=${current.ttlMs} polling window`,
        );
      }
      if (current.status === "input_required") {
        await this.persist(entry, current, stats);
        const handled = await this.handleInputRequired(entry, current, stats, options);
        if (handled.kind === "result") return handled.result;
        current = await this.pollOnce(entry, current, stats);
        continue;
      }
      const remainingMs = stats.deadlineAtMs === null
        ? null
        : Math.max(0, stats.deadlineAtMs - Date.now());
      const pollIntervalMs = current.pollIntervalMs ?? DEFAULT_REMOTE_TASK_POLL_INTERVAL_MS;
      const delayMs = remainingMs === null
        ? pollIntervalMs
        : Math.min(pollIntervalMs, remainingMs);
      if (delayMs <= 0) {
        await this.clear(entry, current);
        return remoteTaskErrorResult(
          entry,
          current,
          stats,
          `exceeded its ttlMs=${current.ttlMs} polling window`,
        );
      }
      try {
        await sleepUntilNextPoll(delayMs, options.signal);
      } catch {
        return await this.cancelAfterAbort(entry, current, stats);
      }
      current = await this.pollOnce(entry, current, stats);
    }
  }

  private async pollOnce(
    entry: McpToolEntry,
    current: McpCreateTaskResult | McpGetTaskResult,
    stats: McpRemoteTaskStats,
  ): Promise<McpGetTaskResult> {
    try {
      const next = await entry.client.getTask(current.taskId);
      stats.pollCount += 1;
      await this.persist(entry, next, stats);
      return next;
    } catch (err) {
      await this.persist(
        entry,
        current,
        stats,
        remoteTaskPollingErrorMessage(err as Error),
      );
      throw err;
    }
  }

  private async persist(
    entry: McpToolEntry,
    task: McpCreateTaskResult | McpGetTaskResult,
    stats: McpRemoteTaskStats,
    lastDiagnostic?: string,
  ): Promise<void> {
    const identity = this.serverIdentities.get(entry.serverConfigName);
    if (!identity) return;
    const handle: PersistedRemoteMcpTaskHandle = {
      id: remoteMcpTaskHandleId(entry.serverConfigName, task.taskId),
      serverConfigName: entry.serverConfigName,
      serverDisplayName: entry.client.getName(),
      serverFingerprint: identity.fingerprint,
      serverMatch: identity.match,
      toolName: entry.originalName,
      toolDeclarationFingerprint: stats.toolDeclarationFingerprint,
      taskId: task.taskId,
      protocolVersion: stats.protocolVersion,
      status: task.status,
      createdAt: task.createdAt,
      lastUpdatedAt: task.lastUpdatedAt,
      ttlMs: task.ttlMs,
      ...(task.pollIntervalMs !== undefined ? { pollIntervalMs: task.pollIntervalMs } : {}),
      pollCount: stats.pollCount,
      inputUpdateCount: stats.inputUpdateCount,
      startedAt: new Date(stats.startedAtMs).toISOString(),
      deadlineAt: stats.deadlineAtMs === null
        ? null
        : new Date(stats.deadlineAtMs).toISOString(),
      updatedAt: new Date().toISOString(),
      ...(lastDiagnostic !== undefined ? { lastDiagnostic } : {}),
    };
    await this.store.upsert(handle);
  }

  private async clear(
    entry: McpToolEntry,
    task: McpCreateTaskResult | McpGetTaskResult,
  ): Promise<void> {
    await this.store.remove(remoteMcpTaskHandleId(entry.serverConfigName, task.taskId));
  }

  private async resume(
    handle: PersistedRemoteMcpTaskHandle,
  ): Promise<McpRemoteTaskResumeResult> {
    const currentIdentity = this.serverIdentities.get(handle.serverConfigName);
    if (!currentIdentity) {
      return await this.resumeDiagnostic(
        handle,
        `configured MCP server "${handle.serverConfigName}" is not present; remote task was not resumed`,
      );
    }
    if (currentIdentity.fingerprint !== handle.serverFingerprint) {
      return await this.resumeDiagnostic(
        handle,
        `configured MCP server "${handle.serverConfigName}" no longer matches the persisted remote task handle; remote task was not resumed`,
      );
    }
    if (currentIdentity.match.kind === "ambiguous") {
      return await this.resumeDiagnostic(handle, currentIdentity.match.reason);
    }

    const client = this.clients.get(handle.serverConfigName);
    if (!client?.isConnected()) {
      return await this.resumeDiagnostic(
        handle,
        `configured MCP server "${handle.serverConfigName}" is not connected; remote task was not resumed`,
      );
    }
    if (!client.supportsTasks()) {
      return await this.resumeDiagnostic(
        handle,
        `configured MCP server "${handle.serverConfigName}" did not negotiate io.modelcontextprotocol/tasks; remote task was not resumed`,
      );
    }

    try {
      const resolvedEntry = entryForPersistedRemoteTask({
        handle,
        client,
        entries: this.registry.getServerToolEntries(handle.serverConfigName),
      });
      if (resolvedEntry.kind === "diagnostic") {
        return await this.resumeDiagnostic(handle, resolvedEntry.message);
      }
      const entry = resolvedEntry.entry;
      const stats = remoteTaskStatsForPersistedHandle(handle);
      const current = await client.getTask(handle.taskId);
      stats.pollCount += 1;
      await this.persist(entry, current, stats);
      const result = await this.poll(entry, current, stats, {});
      return {
        kind: "result",
        serverConfigName: handle.serverConfigName,
        serverDisplayName: client.getName(),
        tool: handle.toolName,
        taskId: handle.taskId,
        result,
      };
    } catch (err) {
      const message = err instanceof McpToolError
        ? err.message
        : `MCP remote task resume error: ${(err as Error).message}`;
      return await this.resumeDiagnostic(handle, message);
    }
  }

  private async resumeDiagnostic(
    handle: PersistedRemoteMcpTaskHandle,
    message: string,
  ): Promise<McpRemoteTaskResumeResult> {
    await this.store.upsert({
      ...handle,
      lastDiagnostic: message,
      updatedAt: new Date().toISOString(),
    });
    return {
      kind: "diagnostic",
      serverConfigName: handle.serverConfigName,
      serverDisplayName: handle.serverDisplayName,
      tool: handle.toolName,
      taskId: handle.taskId,
      message,
    };
  }

  private async handleInputRequired(
    entry: McpToolEntry,
    task: McpCreateTaskResult | McpGetTaskResult,
    stats: McpRemoteTaskStats,
    options: McpExecuteToolOptions,
  ): Promise<{ kind: "continue" } | { kind: "result"; result: ToolResult }> {
    if (!task.inputRequests) {
      await this.persist(
        entry,
        task,
        stats,
        "remote task entered input_required without inputRequests",
      );
      return {
        kind: "result",
        result: remoteTaskErrorResult(
          entry,
          task,
          stats,
          "entered input_required without inputRequests",
        ),
      };
    }
    if (!options.inputResolver) {
      await this.persist(
        entry,
        task,
        stats,
        "remote task entered input_required, but no input resolver is available",
      );
      return {
        kind: "result",
        result: withRemoteTaskDiagnostics(
          unsupportedInputRequiredResult(entry, {
            resultType: "input_required",
            protocolVersion: stats.protocolVersion,
            inputRequests: task.inputRequests,
            ...(task.requestState !== undefined ? { requestState: task.requestState } : {}),
            ...(task._meta ? { _meta: task._meta } : {}),
          }),
          entry,
          task,
          stats,
        ),
      };
    }
    const routed = await options.inputResolver({
      server: entry.client.getName(),
      tool: entry.originalName,
      inputRequests: task.inputRequests,
      ...(task.requestState !== undefined ? { requestState: task.requestState } : {}),
      ...(task._meta ? { resultMeta: task._meta } : {}),
    });
    if (routed.kind === "unavailable") {
      await this.persist(entry, task, stats, routed.reason);
      return {
        kind: "result",
        result: withRemoteTaskDiagnostics(
          unsupportedInputRequiredResult(entry, {
            resultType: "input_required",
            protocolVersion: stats.protocolVersion,
            inputRequests: task.inputRequests,
            ...(task.requestState !== undefined ? { requestState: task.requestState } : {}),
            ...(task._meta ? { _meta: task._meta } : {}),
          }, routed.reason),
          entry,
          task,
          stats,
        ),
      };
    }
    await entry.client.updateTask(task.taskId, {
      inputRequests: task.inputRequests,
      inputResponses: routed.inputResponses,
      ...(task.requestState !== undefined ? { requestState: task.requestState } : {}),
    });
    stats.inputUpdateCount += 1;
    return { kind: "continue" };
  }

  private async cancelAfterAbort(
    entry: McpToolEntry,
    task: McpCreateTaskResult | McpGetTaskResult,
    stats: McpRemoteTaskStats,
  ): Promise<ToolResult> {
    try {
      await entry.client.cancelTask(task.taskId);
      await this.clear(entry, task);
      return remoteTaskErrorResult(
        entry,
        task,
        stats,
        "was aborted by the operator and cancellation was requested",
      );
    } catch {
      await this.persist(
        entry,
        task,
        stats,
        "operator aborted polling; cancellation could not be confirmed",
      );
      return remoteTaskErrorResult(
        entry,
        task,
        stats,
        "was aborted by the operator; cancellation could not be confirmed",
      );
    }
  }
}
