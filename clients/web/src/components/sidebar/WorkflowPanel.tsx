import { api } from "@/api/client";
import {
  queryKeys,
  workflowRunsQuery,
  workflowStatusQuery,
} from "@/api/queries";
import type { WorkflowRunSummary } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { fmtDuration } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

type WorkflowFilter = {
  workflow: string;
  status: string;
  dateRange: "all" | "today" | "7d";
  tag: string;
  search: string;
};

export function WorkflowPanel({
  onRunSelect,
}: { onRunSelect: (id: string) => void }) {
  const queryClient = useQueryClient();
  const { data: statusData } = useQuery(workflowStatusQuery);
  const { data: runsData } = useQuery(workflowRunsQuery({ limit: 50 }));
  const [filter, setFilter] = useState<WorkflowFilter>({
    workflow: "",
    status: "",
    dateRange: "all",
    tag: "",
    search: "",
  });

  const activeRuns = statusData?.activeRuns ?? [];
  const pendingRuns = statusData?.pendingRuns ?? [];
  const recentRuns = runsData?.runs ?? [];
  const paused = statusData?.paused ?? false;
  const workflowNames = Object.keys(statusData?.workflows ?? {}).sort();

  const tagSet = new Set<string>();
  for (const r of recentRuns) {
    for (const t of r.tags ?? []) tagSet.add(t);
  }
  const tagNames = [...tagSet].sort();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.workflowStatus });
    void queryClient.invalidateQueries({ queryKey: ["workflowRuns"] });
  };

  const pauseMutation = useMutation({
    mutationFn: paused ? api.resumeWorkflow : api.pauseWorkflow,
    onSuccess: invalidate,
  });
  const abortMutation = useMutation({
    mutationFn: api.abortWorkflows,
    onSuccess: invalidate,
  });
  const triggerMutation = useMutation({
    mutationFn: (name: string) => api.triggerWorkflow(name),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.cancelWorkflowRun(id),
    onSuccess: invalidate,
  });
  const retryMutation = useMutation({
    mutationFn: (id: string) => api.retryWorkflowRun(id),
    onSuccess: invalidate,
  });

  const filtered = filterRuns(recentRuns, filter);
  const activeIds = new Set(activeRuns.map((r) => r.runId));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant={paused ? "default" : "outline"}
          className="h-6 text-xs"
          onClick={() => pauseMutation.mutate()}
        >
          {paused ? "\u25B6 Resume" : "\u23F8 Pause"}
        </Button>
        {statusData?.dispatchWindowBlocked && (
          <Badge variant="warning" className="text-[10px]">
            \u23F0 window blocked
            {statusData.dispatchWindowOpensAt &&
              ` (opens ${new Date(statusData.dispatchWindowOpensAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`}
          </Badge>
        )}
        {activeRuns.length > 0 && (
          <Button
            size="sm"
            variant="destructive"
            className="h-6 text-xs"
            onClick={() => abortMutation.mutate()}
          >
            \u23F9 Abort
          </Button>
        )}
        {workflowNames.map((name) => (
          <Button
            key={name}
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() => triggerMutation.mutate(name)}
          >
            \u25B6 {name}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1">
        <Select
          className="h-7 w-auto text-xs"
          value={filter.workflow}
          onChange={(e) =>
            setFilter((f) => ({ ...f, workflow: e.target.value }))
          }
        >
          <option value="">All</option>
          {workflowNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
        <Select
          className="h-7 w-auto text-xs"
          value={filter.status}
          onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">Any status</option>
          <option value="failed">Failed</option>
          <option value="success">Completed</option>
          <option value="interrupted">Interrupted</option>
          <option value="completed-with-warnings">Warnings</option>
        </Select>
        {tagNames.length > 0 && (
          <Select
            className="h-7 w-auto text-xs"
            value={filter.tag}
            onChange={(e) => setFilter((f) => ({ ...f, tag: e.target.value }))}
          >
            <option value="">All tags</option>
            {tagNames.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        )}
      </div>
      <Input
        className="h-7 text-xs"
        placeholder="Search run ID, workflow, trigger..."
        value={filter.search}
        onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
      />

      <div className="flex gap-1">
        {(["all", "today", "7d"] as const).map((range) => (
          <Button
            key={range}
            size="sm"
            variant={filter.dateRange === range ? "default" : "ghost"}
            className="h-6 text-xs"
            onClick={() => setFilter((f) => ({ ...f, dateRange: range }))}
          >
            {range === "all"
              ? "All time"
              : range === "today"
                ? "Today"
                : "7 days"}
          </Button>
        ))}
      </div>

      <div className="space-y-0.5">
        {pendingRuns.map((p) => (
          <div
            key={p.runId}
            className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs"
          >
            <Badge variant="warning" className="h-4 px-1 text-[10px]">
              \u23F3
            </Badge>
            <span className="flex-1 truncate">{p.workflowName}</span>
            <span className="text-muted-foreground">queued</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 text-[10px]"
              onClick={() => cancelMutation.mutate(p.runId)}
            >
              \u2715
            </Button>
          </div>
        ))}
        {activeRuns.map((r) => (
          <button
            key={r.runId}
            type="button"
            className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent"
            onClick={() => onRunSelect(r.runId)}
          >
            <Badge variant="running" className="h-4 px-1 text-[10px]">
              \u25B6
            </Badge>
            <span className="flex-1 truncate text-left">{r.workflow}</span>
            <span className="text-muted-foreground">
              {fmtDuration(Date.now() - new Date(r.startedAt).getTime())}
            </span>
          </button>
        ))}
        {filtered
          .filter((r) => !activeIds.has(r.id) && r.status !== "running")
          .map((r) => (
            <RunItem
              key={r.id}
              run={r}
              onClick={() => onRunSelect(r.id)}
              onRetry={() => retryMutation.mutate(r.id)}
            />
          ))}
        {pendingRuns.length === 0 &&
          activeRuns.length === 0 &&
          filtered.length === 0 && (
            <div className="text-xs text-muted-foreground">No recent runs</div>
          )}
      </div>
    </div>
  );
}

function RunItem({
  run,
  onClick,
  onRetry,
}: { run: WorkflowRunSummary; onClick: () => void; onRetry: () => void }) {
  const statusBadge =
    run.status === "success"
      ? { variant: "success" as const, icon: "\u2713" }
      : run.status === "failed"
        ? { variant: "destructive" as const, icon: "\u2717" }
        : run.status === "completed-with-warnings"
          ? { variant: "warning" as const, icon: "\u26A0" }
          : { variant: "secondary" as const, icon: "\u26A1" };

  const meta = [
    run.durationMs ? fmtDuration(run.durationMs) : "",
    run.totalCostUsd != null ? `$${run.totalCostUsd.toFixed(3)}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className="group flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent"
      onClick={onClick}
    >
      <Badge variant={statusBadge.variant} className="h-4 px-1 text-[10px]">
        {statusBadge.icon}
      </Badge>
      <span className="flex-1 truncate text-left">
        {run.workflow}
        {run.tags?.map((t) => (
          <Badge
            key={t}
            variant="outline"
            className="ml-0.5 h-3.5 px-1 text-[9px]"
          >
            {t}
          </Badge>
        ))}
      </span>
      <span className="text-muted-foreground">{meta}</span>
      {(run.status === "failed" || run.status === "interrupted") && (
        <span
          className="hidden text-[10px] text-muted-foreground group-hover:inline"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
        >
          \u21BA Retry
        </span>
      )}
    </button>
  );
}

function filterRuns(
  runs: WorkflowRunSummary[],
  filter: WorkflowFilter,
): WorkflowRunSummary[] {
  let cutoff = 0;
  if (filter.dateRange === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    cutoff = d.getTime();
  } else if (filter.dateRange === "7d") {
    cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  }
  const search = filter.search.toLowerCase();
  return runs.filter((r) => {
    if (filter.workflow && r.workflow !== filter.workflow) return false;
    if (filter.status && r.status !== filter.status) return false;
    if (cutoff && new Date(r.startedAt).getTime() < cutoff) return false;
    if (filter.tag && !r.tags?.includes(filter.tag)) return false;
    if (search) {
      const match =
        r.id.toLowerCase().includes(search) ||
        r.workflow.toLowerCase().includes(search) ||
        r.triggerEvent.toLowerCase().includes(search);
      if (!match) return false;
    }
    return true;
  });
}
