import { createHmac, timingSafeEqual } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { KotaConfig } from "../config.js";
import type { EventBus } from "../event-bus.js";
import { loadModuleMetadata } from "../module-metadata.js";
import { getApprovalQueue } from "../modules/approval-queue/queue.js";
import { getHistory } from "../memory/history.js";
import { getRepoInboxDir, getRepoTasksDir } from "../repo-tasks.js";
import type { WorkflowRunStore } from "../workflow/run-store.js";
import type { WorkflowRuntime } from "../workflow/runtime.js";
import type {
  DaemonControlHandle,
  DaemonTaskStatusResponse,
  InteractiveSession,
  WorkflowCostEntry,
  WorkflowDefinitionSummary,
  WorkflowDurationHistogramEntry,
  WorkflowMetricCounts,
  WorkflowRunCountEntry,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "./daemon-control-types.js";
import type { DaemonState } from "./daemon-state.js";
import { registerPushToken, sendPushNotifications } from "./push-tokens.js";

export type DaemonHandleContext = {
  getState: () => DaemonState;
  isRunning: () => boolean;
  workflows: WorkflowRuntime;
  bus: EventBus;
  sessions: Map<string, InteractiveSession>;
  runStore: WorkflowRunStore;
  projectDir: string;
  config: { config?: KotaConfig; verbose?: boolean };
  log: (message: string) => void;
};

export function buildDaemonHandle(ctx: DaemonHandleContext): DaemonControlHandle {
  const { workflows, bus, sessions, runStore, projectDir, config, log } = ctx;

  // Local mutable state that only the handle needs.
  let metricCountsCache: WorkflowMetricCounts | null = null;
  let metricCountsCacheAt = 0;
  const webhookTimestamps = new Map<string, number[]>();

  // Subscribe to approval.requested for push notification delivery (fire-and-forget).
  bus.on("approval.requested", (p) => {
    void sendPushNotifications(
      projectDir,
      {
        approvalId: String(p.id ?? ""),
        tool: String(p.tool ?? ""),
        risk: String(p.risk ?? ""),
        source: String(p.source ?? ""),
      },
      log,
    );
  });

  return {
    getHealthStatus: () => ({
      scheduler: "ok" as const,
      modules: "ok" as const,
    }),
    getDaemonLiveState: () => ({ ...ctx.getState(), running: ctx.isRunning() }),
    getWorkflowLiveStatus: () => {
      const wfState = workflows.getState();
      const windowStatus = workflows.getDispatchWindowStatus();
      return {
        activeRuns: wfState.activeRuns ?? [],
        pendingRuns: wfState.pendingRuns,
        queueLength: wfState.queueLength,
        completedRuns: wfState.completedRuns,
        totalCostUsd: wfState.totalCostUsd,
        agentBackoff: wfState.agentBackoff,
        definitionsLoadedAt: wfState.definitionsLoadedAt,
        workflows: wfState.workflows,
        paused: workflows.isDispatchPaused(),
        agentConcurrency: wfState.agentConcurrency,
        codeConcurrency: wfState.codeConcurrency,
        ...(windowStatus.blocked && {
          dispatchWindowBlocked: true,
          dispatchWindowOpensAt: windowStatus.opensAt,
        }),
      };
    },
    pauseWorkflowDispatch: () => {
      const already = workflows.isDispatchPaused();
      if (!already) workflows.setDispatchPaused(true);
      return { already };
    },
    resumeWorkflowDispatch: () => {
      const already = !workflows.isDispatchPaused();
      if (!already) workflows.setDispatchPaused(false);
      return { already };
    },
    abortActiveRuns: () => workflows.abortActiveRuns(),
    abortActiveRun: (runId: string) => workflows.abortActiveRun(runId),
    reloadWorkflowDefinitions: () => workflows.reloadWorkflowDefinitions(),
    reloadConfig: async () => {
      const loader = await loadModuleMetadata(
        config.config ?? {},
        projectDir,
        config.verbose ?? false,
      );
      workflows.setWorkflowInputs(loader.getContributedWorkflows());
      const { count } = workflows.reloadWorkflowDefinitions();
      log(`Config reloaded: ${count} workflow definition(s) active`);
      const userExtensions = loader
        .getModuleSummaries()
        .map((summary) => summary.name)
        .filter((name) => name !== "workflow");
      if (userExtensions.length > 0) {
        log(`  Modules: ${userExtensions.join(", ")}`);
      }
      return { workflows: count };
    },
    getWorkflowDefinitions: (): WorkflowDefinitionSummary[] =>
      workflows.getDefinitions().map((def) => {
        const sourceEnabled = workflows.getDefinitionSourceEnabled(def.name);
        const hasOverride = sourceEnabled !== undefined && sourceEnabled !== def.enabled;
        return {
          name: def.name,
          enabled: sourceEnabled !== undefined ? sourceEnabled : def.enabled,
          ...(hasOverride ? { runtimeEnabled: def.enabled } : {}),
          stepCount: def.steps.length,
          triggers: def.triggers.map((t): WorkflowDefinitionSummary["triggers"][number] => {
            if (t.webhook) return { type: "webhook" };
            if (t.watch) return { type: "watch", patterns: t.watch, debounceMs: t.debounceMs ?? 500 };
            if (t.schedule) return { type: "cron", schedule: t.schedule };
            if (t.intervalMs != null) return { type: "interval", intervalMs: t.intervalMs };
            return { type: "event", event: t.event };
          }),
          ...(def.inputSchema !== undefined ? { inputSchema: def.inputSchema } : {}),
          ...(def.outputSchema !== undefined ? { outputSchema: def.outputSchema } : {}),
        };
      }),
    enableWorkflow: (name: string) => workflows.enableWorkflow(name),
    disableWorkflow: (name: string) => workflows.disableWorkflow(name),
    enqueuePendingRun: (name: string, tags?: string[], extraPayload?: Record<string, unknown>) =>
      workflows.enqueuePendingRun(name, tags, extraPayload),
    cancelQueuedRun: (runId: string) => workflows.cancelQueuedRun(runId),
    subscribeToEvents: (handler) => {
      const stops = [
        bus.on("workflow.started", (p) => {
          handler({ type: "workflow.started", payload: p as unknown as Record<string, unknown> });
          handler({ type: "queue.changed", payload: { source: "workflow.started", workflow: p.workflow } });
        }),
        bus.on("workflow.completed", (p) => {
          handler({ type: "workflow.completed", payload: p as unknown as Record<string, unknown> });
          handler({ type: "queue.changed", payload: { source: "workflow.completed", workflow: p.workflow, status: p.status } });
        }),
        bus.on("workflow.step.completed", (p) =>
          handler({ type: "workflow.step.completed", payload: p as unknown as Record<string, unknown> }),
        ),
        bus.on("approval.changed", (p) =>
          handler({ type: "approval.changed", payload: p as unknown as Record<string, unknown> }),
        ),
        bus.on("task.changed", (p) =>
          handler({ type: "task.changed", payload: p as unknown as Record<string, unknown> }),
        ),
        bus.on("session.registered", (p) =>
          handler({ type: "session.registered", payload: p as unknown as Record<string, unknown> }),
        ),
        bus.on("session.unregistered", (p) =>
          handler({ type: "session.unregistered", payload: p as unknown as Record<string, unknown> }),
        ),
      ];
      return () => stops.forEach((s) => s());
    },
    listHistory: (search?: string, limit = 20) => getHistory().list({ search, limit }),
    getHistory: (id: string) => getHistory().load(id) ?? null,
    deleteHistory: (id: string) => getHistory().remove(id),
    listApprovals: () => getApprovalQueue().list("pending"),
    approveApproval: (id: string, note?: string) => getApprovalQueue().approve(id, note),
    rejectApproval: (id: string, reason?: string) => getApprovalQueue().reject(id, reason),
    listWorkflowRuns: (workflow?: string, limit?: number, tag?: string, causedByRunId?: string): WorkflowRunSummary[] =>
      runStore.listRuns({ workflow, limit, tag, causedByRunId }).map((m) => ({
        id: m.id,
        workflow: m.workflow,
        status: m.status,
        triggerEvent: m.trigger.event,
        startedAt: m.startedAt,
        ...(m.durationMs != null && { durationMs: m.durationMs }),
        ...(m.totalCostUsd != null && { totalCostUsd: m.totalCostUsd }),
        ...(m.triggeredByRunId != null && { triggeredByRunId: m.triggeredByRunId }),
        ...(m.causedBy != null && { causedBy: m.causedBy }),
        ...(m.retryOf != null && { retryOf: m.retryOf }),
        ...(m.resumedFromRunId != null && { resumedFromRunId: m.resumedFromRunId }),
        ...(m.tags && m.tags.length > 0 && { tags: m.tags }),
      })),
    getWorkflowRun: (id: string): WorkflowRunDetail | null => {
      const m = runStore.getRun(id);
      if (!m) return null;
      return {
        id: m.id,
        workflow: m.workflow,
        status: m.status,
        triggerEvent: m.trigger.event,
        startedAt: m.startedAt,
        ...(m.completedAt != null && { completedAt: m.completedAt }),
        ...(m.durationMs != null && { durationMs: m.durationMs }),
        ...(m.totalCostUsd != null && { totalCostUsd: m.totalCostUsd }),
        ...(m.triggeredByRunId != null && { triggeredByRunId: m.triggeredByRunId }),
        ...(m.causedBy != null && { causedBy: m.causedBy }),
        ...(m.retryOf != null && { retryOf: m.retryOf }),
        ...(m.resumedFromRunId != null && { resumedFromRunId: m.resumedFromRunId }),
        ...(m.tags && m.tags.length > 0 && { tags: m.tags }),
        ...(m.trigger.payload && Object.keys(m.trigger.payload).length > 0 && { triggerPayload: m.trigger.payload }),
        ...(m.warnings && m.warnings.length > 0 && { warnings: m.warnings }),
        steps: m.steps.map((s) => {
          const agentCost = s.type === "agent" && typeof (s.output as { totalCostUsd?: unknown } | null | undefined)?.totalCostUsd === "number"
            ? (s.output as { totalCostUsd: number }).totalCostUsd
            : undefined;
          return {
            id: s.id,
            type: s.type,
            status: s.status,
            durationMs: s.durationMs,
            ...(s.error != null && { error: s.error }),
            ...(agentCost != null && { costUsd: agentCost }),
            ...(s.toolCalls != null && { toolCalls: s.toolCalls }),
          };
        }),
      };
    },
    getTaskStatus: () => readTaskStatus(projectDir),
    getWorkflowMetricCounts: (): WorkflowMetricCounts => {
      const now = Date.now();
      if (metricCountsCache && now - metricCountsCacheAt < 30_000) {
        return metricCountsCache;
      }
      const DURATION_BUCKETS_S = [30, 120, 300, 900, 1800, 3600] as const;
      const runs = runStore.listRuns({ limit: 100_000 });
      const countMap = new Map<string, number>();
      const costMap = new Map<string, number>();
      const durationMap = new Map<string, { buckets: Map<number | "+Inf", number>; sum: number; count: number }>();
      for (const run of runs) {
        if (!run.workflow || !run.status || run.status === "running") continue;
        const countKey = `${run.workflow}\x00${run.status}`;
        countMap.set(countKey, (countMap.get(countKey) ?? 0) + 1);
        if (typeof run.totalCostUsd === "number") {
          costMap.set(run.workflow, (costMap.get(run.workflow) ?? 0) + run.totalCostUsd);
        }
        if (typeof run.durationMs === "number") {
          const durationS = run.durationMs / 1000;
          let entry = durationMap.get(countKey);
          if (!entry) {
            const buckets = new Map<number | "+Inf", number>();
            for (const b of DURATION_BUCKETS_S) buckets.set(b, 0);
            buckets.set("+Inf", 0);
            entry = { buckets, sum: 0, count: 0 };
            durationMap.set(countKey, entry);
          }
          for (const b of DURATION_BUCKETS_S) {
            if (durationS <= b) entry.buckets.set(b, (entry.buckets.get(b) ?? 0) + 1);
          }
          entry.buckets.set("+Inf", (entry.buckets.get("+Inf") ?? 0) + 1);
          entry.sum += durationS;
          entry.count += 1;
        }
      }
      const runCounts: WorkflowRunCountEntry[] = [];
      for (const [key, count] of countMap) {
        const sep = key.indexOf("\x00");
        runCounts.push({ workflow: key.slice(0, sep), status: key.slice(sep + 1), count });
      }
      const costTotals: WorkflowCostEntry[] = [];
      for (const [workflow, costUsd] of costMap) {
        costTotals.push({ workflow, costUsd });
      }
      const durationHistogram: WorkflowDurationHistogramEntry[] = [];
      for (const [key, entry] of durationMap) {
        const sep = key.indexOf("\x00");
        durationHistogram.push({
          workflow: key.slice(0, sep),
          status: key.slice(sep + 1),
          buckets: [...entry.buckets.entries()].map(([le, count]) => ({ le, count })),
          sum: entry.sum,
          count: entry.count,
        });
      }
      const result: WorkflowMetricCounts = { runCounts, costTotals, durationHistogram };
      metricCountsCache = result;
      metricCountsCacheAt = now;
      return result;
    },
    registerPushToken: (deviceId: string, token: string) => {
      registerPushToken(projectDir, deviceId, token);
    },
    registerSession: (id: string, createdAt: string) => {
      sessions.set(id, { id, createdAt, lastActive: Date.now() });
      bus.emit("session.registered", { id, createdAt });
    },
    unregisterSession: (id: string) => {
      sessions.delete(id);
      bus.emit("session.unregistered", { id });
    },
    listSessions: () => [...sessions.values()],
    triggerWebhookRun: (name, signature, rawBody, payload, webhookTimestamp) => {
      const expectedSecret = config.config?.webhooks?.[name]?.secret;
      if (!expectedSecret) return { ok: false, unauthorized: true };
      const hexSig = signature.startsWith("sha256=") ? signature.slice(7) : signature;
      const expected = createHmac("sha256", expectedSecret).update(rawBody).digest("hex");
      let sigMatch = false;
      try {
        sigMatch = timingSafeEqual(Buffer.from(hexSig, "hex"), Buffer.from(expected, "hex"));
      } catch {
        sigMatch = false;
      }
      if (!sigMatch) return { ok: false, unauthorized: true };
      if (webhookTimestamp !== undefined) {
        const ts = parseInt(webhookTimestamp, 10);
        if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
          return { ok: false, unauthorized: true };
        }
      }
      const definition = workflows.getDefinitions().find((d) => d.name === name);
      const rateLimit = definition?.webhookRateLimit;
      if (rateLimit) {
        const now = Date.now();
        const windowMs = 60_000;
        const windowStart = now - windowMs;
        const timestamps = (webhookTimestamps.get(name) ?? []).filter((t) => t > windowStart);
        if (timestamps.length >= rateLimit.maxPerMinute) {
          const oldest = timestamps[0];
          const retryAfterMs = oldest + windowMs - now;
          return { ok: false, rateLimited: true, retryAfterMs };
        }
        timestamps.push(now);
        webhookTimestamps.set(name, timestamps);
      }
      const result = workflows.enqueueWebhookRun(name, payload);
      if (result.error?.startsWith("Unknown workflow") || result.error?.includes("no webhook trigger")) {
        return { ok: false, notFound: true };
      }
      return result;
    },
  };
}

function readTaskStatus(projectDir: string): DaemonTaskStatusResponse {
  const tasksDir = getRepoTasksDir(projectDir);
  const inboxDir = getRepoInboxDir(projectDir);
  const countedStates = ["inbox", "ready", "backlog", "doing", "blocked"] as const;
  const detailStates = ["doing", "ready", "backlog", "blocked"] as const;

  const listFiles = (state: string): string[] => {
    const dir = join(tasksDir, state);
    try {
      return readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "AGENTS.md");
    } catch {
      return [];
    }
  };

  const parseFm = (content: string): Record<string, string> => {
    const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return {};
    const fields: Record<string, string> = {};
    for (const line of m[1].split(/\r?\n/)) {
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
    return fields;
  };

  const extractBody = (content: string): string => {
    const bm = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
    return bm ? bm[1].trim() : "";
  };

  const readState = (state: string): DaemonTaskStatusResponse["tasks"]["doing"] =>
    listFiles(state).flatMap((file) => {
      try {
        const content = readFileSync(join(tasksDir, state, file), "utf-8");
        const fm = parseFm(content);
        if (!fm.id || !fm.title) return [];
        return [{ id: fm.id, title: fm.title, priority: fm.priority ?? "", area: fm.area ?? "", summary: fm.summary ?? "", body: extractBody(content) }];
      } catch {
        return [];
      }
    });

  const counts = Object.fromEntries(countedStates.map((s) => [
    s,
    s === "inbox"
      ? (() => {
          try {
            return readdirSync(inboxDir).filter((f) => f.endsWith(".md") && f !== "AGENTS.md").length;
          } catch {
            return 0;
          }
        })()
      : listFiles(s).length,
  ])) as DaemonTaskStatusResponse["counts"];
  const tasks = Object.fromEntries(detailStates.map((s) => [s, readState(s)])) as DaemonTaskStatusResponse["tasks"];
  return { counts, tasks };
}
