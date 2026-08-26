import { projectEvidenceObject, redactSensitiveText } from "#core/evidence/policy.js";
import type {
  DaemonControlHandle,
  WorkflowCostEntry,
  WorkflowDurationHistogramEntry,
  WorkflowMetricCounts,
  WorkflowRunCountEntry,
  WorkflowRunDetail,
  WorkflowRunSummary,
} from "./daemon-control-types.js";
import type { ScopeId } from "./scope-registry.js";
import type { ScopeRuntime } from "./scope-runtime.js";

type RunHandle = Pick<
  DaemonControlHandle,
  "listWorkflowRuns" | "getWorkflowRun" | "getWorkflowMetricCounts"
>;

export function buildDaemonRunHandle(
  lookupRuntime: (scopeId?: ScopeId) => ScopeRuntime,
): RunHandle {
  const metricCountsCache = new Map<
    ScopeId,
    { value: WorkflowMetricCounts; at: number }
  >();
  return {
    listWorkflowRuns: (
      opts?: {
        workflow?: string;
        limit?: number;
        tag?: string;
        causedByRunId?: string;
        scopeId?: ScopeId;
      },
    ): WorkflowRunSummary[] => {
      const { workflow, limit, tag, causedByRunId, scopeId } = opts ?? {};
      const runStore = lookupRuntime(scopeId).runStore;
      return runStore.listRuns({ workflow, limit, tag, causedByRunId }).map((run) => ({
        id: run.id,
        workflow: run.workflow,
        status: run.status,
        triggerEvent: run.trigger.event,
        triggerSchemaRef: run.trigger.schemaRef,
        startedAt: run.startedAt,
        ...(run.durationMs != null && { durationMs: run.durationMs }),
        ...(run.totalCostUsd != null && { totalCostUsd: run.totalCostUsd }),
        ...(run.triggeredByRunId != null && { triggeredByRunId: run.triggeredByRunId }),
        ...(run.causedBy != null && { causedBy: run.causedBy }),
        ...(run.retryOf != null && { retryOf: run.retryOf }),
        ...(run.resumedFromRunId != null && { resumedFromRunId: run.resumedFromRunId }),
        ...(run.tags && run.tags.length > 0 && { tags: run.tags }),
      }));
    },
    getWorkflowRun: (id: string, scopeId?: ScopeId): WorkflowRunDetail | null => {
      const runStore = lookupRuntime(scopeId).runStore;
      const run = runStore.getRun(id);
      if (!run) return null;
      const triggerPayload = Object.keys(run.trigger.payload).length > 0
        ? projectEvidenceObject(run.trigger.payload, "daemon-api")
        : undefined;
      return {
        id: run.id,
        workflow: run.workflow,
        status: run.status,
        triggerEvent: run.trigger.event,
        triggerSchemaRef: run.trigger.schemaRef,
        startedAt: run.startedAt,
        ...(run.completedAt != null && { completedAt: run.completedAt }),
        ...(run.durationMs != null && { durationMs: run.durationMs }),
        ...(run.totalCostUsd != null && { totalCostUsd: run.totalCostUsd }),
        ...(run.triggeredByRunId != null && { triggeredByRunId: run.triggeredByRunId }),
        ...(run.causedBy != null && { causedBy: run.causedBy }),
        ...(run.retryOf != null && { retryOf: run.retryOf }),
        ...(run.resumedFromRunId != null && { resumedFromRunId: run.resumedFromRunId }),
        ...(run.tags && run.tags.length > 0 && { tags: run.tags }),
        ...(triggerPayload !== undefined && { triggerPayload }),
        ...(run.warnings && run.warnings.length > 0 && {
          warnings: run.warnings.map((warning) => ({
            type: warning.type,
            message: redactSensitiveText(warning.message),
          })),
        }),
        steps: run.steps.map((step) => {
          const agentCost = step.type === "agent"
            && typeof (step.output as { totalCostUsd?: number } | null | undefined)?.totalCostUsd
              === "number"
            ? (step.output as { totalCostUsd: number }).totalCostUsd
            : undefined;
          return {
            id: step.id,
            type: step.type,
            status: step.status,
            durationMs: step.durationMs,
            ...(step.error != null && { error: step.error }),
            ...(agentCost != null && { costUsd: agentCost }),
            ...(step.toolCalls != null && { toolCalls: step.toolCalls }),
            ...(step.skipReason != null && { skipReason: step.skipReason }),
          };
        }),
      };
    },
    getWorkflowMetricCounts: (scopeId?: ScopeId): WorkflowMetricCounts => {
      const runtime = lookupRuntime(scopeId);
      const cacheKey = runtime.scope.scopeId;
      const now = Date.now();
      const cached = metricCountsCache.get(cacheKey);
      if (cached && now - cached.at < 30_000) {
        return {
          ...cached.value,
          deadLetterCounts: runtime.deadLetterQueue.counts(runtime.scope.scopeId),
        };
      }
      const durationBucketsSeconds = [30, 120, 300, 900, 1800, 3600] as const;
      const runs = runtime.runStore.listRuns({ limit: 100_000 });
      const countMap = new Map<string, number>();
      const costMap = new Map<string, number>();
      const durationMap = new Map<
        string,
        { buckets: Map<number | "+Inf", number>; sum: number; count: number }
      >();
      for (const run of runs) {
        if (!run.workflow || !run.status || run.status === "running") continue;
        const countKey = `${run.workflow}\x00${run.status}`;
        countMap.set(countKey, (countMap.get(countKey) ?? 0) + 1);
        if (typeof run.totalCostUsd === "number") {
          costMap.set(run.workflow, (costMap.get(run.workflow) ?? 0) + run.totalCostUsd);
        }
        if (typeof run.durationMs !== "number") continue;
        const durationSeconds = run.durationMs / 1000;
        let entry = durationMap.get(countKey);
        if (!entry) {
          const buckets = new Map<number | "+Inf", number>();
          for (const bucket of durationBucketsSeconds) buckets.set(bucket, 0);
          buckets.set("+Inf", 0);
          entry = { buckets, sum: 0, count: 0 };
          durationMap.set(countKey, entry);
        }
        for (const bucket of durationBucketsSeconds) {
          if (durationSeconds <= bucket) {
            entry.buckets.set(bucket, (entry.buckets.get(bucket) ?? 0) + 1);
          }
        }
        entry.buckets.set("+Inf", (entry.buckets.get("+Inf") ?? 0) + 1);
        entry.sum += durationSeconds;
        entry.count += 1;
      }
      const runCounts: WorkflowRunCountEntry[] = [];
      for (const [key, count] of countMap) {
        const separator = key.indexOf("\x00");
        runCounts.push({
          workflow: key.slice(0, separator),
          status: key.slice(separator + 1),
          count,
        });
      }
      const costTotals: WorkflowCostEntry[] = [];
      for (const [workflow, costUsd] of costMap) costTotals.push({ workflow, costUsd });
      const durationHistogram: WorkflowDurationHistogramEntry[] = [];
      for (const [key, entry] of durationMap) {
        const separator = key.indexOf("\x00");
        durationHistogram.push({
          workflow: key.slice(0, separator),
          status: key.slice(separator + 1),
          buckets: [...entry.buckets.entries()].map(([le, count]) => ({ le, count })),
          sum: entry.sum,
          count: entry.count,
        });
      }
      const result: WorkflowMetricCounts = {
        runCounts,
        costTotals,
        durationHistogram,
        deadLetterCounts: runtime.deadLetterQueue.counts(runtime.scope.scopeId),
      };
      metricCountsCache.set(cacheKey, { value: result, at: now });
      return result;
    },
  };
}
