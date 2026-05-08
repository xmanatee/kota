import { api } from "@/api/client";
import {
  queryKeys,
  workflowDefinitionsQuery,
  workflowRunsQuery,
  workflowStatusQuery,
} from "@/api/queries";
import type {
  WorkflowDefinitionSummary,
  WorkflowRunSummary,
} from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useProjectId } from "@/lib/project-context";
import { fmtDuration } from "@/lib/utils";
import { parseTriggerFields } from "@/lib/workflow-trigger-schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { WorkflowTriggerForm } from "./WorkflowTriggerForm";

type WorkflowFilter = {
  workflow: string;
  status: string;
  dateRange: "all" | "today" | "7d";
  tag: string;
  search: string;
};

export function WorkflowPanel({
  onRunSelect,
  onCompareRuns,
}: {
  onRunSelect: (id: string) => void;
  onCompareRuns: (idA: string, idB: string) => void;
}) {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  const { data: statusData } = useQuery(workflowStatusQuery(projectId));
  const { data: definitionsData } = useQuery(
    workflowDefinitionsQuery(projectId),
  );
  const { data: runsData } = useQuery(
    workflowRunsQuery(projectId, { limit: 50 }),
  );
  const [filter, setFilter] = useState<WorkflowFilter>({
    workflow: "",
    status: "",
    dateRange: "all",
    tag: "",
    search: "",
  });
  const [openFormFor, setOpenFormFor] = useState<string | null>(null);
  const [compareSelection, setCompareSelection] = useState<string[]>([]);

  const activeRuns = statusData?.activeRuns ?? [];
  const pendingRuns = statusData?.pendingRuns ?? [];
  const recentRuns = runsData?.runs ?? [];
  const paused = statusData?.paused ?? false;
  const definitions: WorkflowDefinitionSummary[] =
    definitionsData?.definitions ?? [];
  const definitionByName = new Map(definitions.map((d) => [d.name, d]));
  const workflowNames =
    definitions.length > 0
      ? definitions.map((d) => d.name).sort()
      : Object.keys(statusData?.workflows ?? {}).sort();

  const tagSet = new Set<string>();
  for (const r of recentRuns) {
    for (const t of r.tags ?? []) tagSet.add(t);
  }
  const tagNames = [...tagSet].sort();

  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.workflowStatus(projectId),
    });
    void queryClient.invalidateQueries({
      queryKey: ["workflowRuns", projectId],
    });
  };

  const pauseMutation = useMutation({
    mutationFn: () =>
      paused ? api.resumeWorkflow(projectId) : api.pauseWorkflow(projectId),
    onSuccess: invalidate,
  });
  const abortMutation = useMutation({
    mutationFn: () => api.abortWorkflows(projectId),
    onSuccess: invalidate,
  });
  const triggerMutation = useMutation({
    mutationFn: ({
      name,
      payload,
    }: { name: string; payload?: Record<string, string | number | boolean> }) =>
      api.triggerWorkflow(name, projectId, payload),
    onSuccess: () => {
      setOpenFormFor(null);
      invalidate();
    },
  });

  function handleTriggerClick(name: string): void {
    const def = definitionByName.get(name);
    const fields = parseTriggerFields(def?.inputSchema);
    if (fields.length === 0) {
      triggerMutation.mutate({ name });
      return;
    }
    setOpenFormFor((current) => (current === name ? null : name));
  }

  const openForm = openFormFor ? definitionByName.get(openFormFor) : undefined;
  const openFormFields = openForm
    ? parseTriggerFields(openForm.inputSchema)
    : [];
  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.cancelWorkflowRun(id, projectId),
    onSuccess: invalidate,
  });
  const retryMutation = useMutation({
    mutationFn: (id: string) => api.retryWorkflowRun(id, projectId),
    onSuccess: invalidate,
  });

  const filtered = filterRuns(recentRuns, filter);
  const activeIds = new Set(activeRuns.map((r) => r.runId));
  const runById = new Map(recentRuns.map((r) => [r.id, r]));
  const selectedRuns = compareSelection
    .map((id) => runById.get(id))
    .filter((r): r is WorkflowRunSummary => r !== undefined);
  const compareWorkflowMismatch =
    selectedRuns.length === 2 &&
    selectedRuns[0]!.workflow !== selectedRuns[1]!.workflow;
  const canCompare = selectedRuns.length === 2 && !compareWorkflowMismatch;

  function toggleCompare(id: string): void {
    setCompareSelection((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id);
      if (current.length >= 2) return [current[1]!, id];
      return [...current, id];
    });
  }

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
        {workflowNames.map((name) => {
          const def = definitionByName.get(name);
          const hasInput =
            def != null && parseTriggerFields(def.inputSchema).length > 0;
          return (
            <Button
              key={name}
              size="sm"
              variant="ghost"
              className="h-6 text-xs"
              onClick={() => handleTriggerClick(name)}
            >
              \u25B6 {name}
              {hasInput && (
                <span className="ml-1 text-muted-foreground">\u2026</span>
              )}
            </Button>
          );
        })}
      </div>

      {openForm && openFormFields.length > 0 && (
        <WorkflowTriggerForm
          workflowName={openForm.name}
          fields={openFormFields}
          busy={triggerMutation.isPending}
          onSubmit={(payload) =>
            triggerMutation.mutate({ name: openForm.name, payload })
          }
          onCancel={() => setOpenFormFor(null)}
        />
      )}

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

      {compareSelection.length > 0 && (
        <section
          className="flex items-center gap-1.5 rounded border border-border bg-accent/50 px-2 py-1 text-xs"
          aria-label="Compare runs"
        >
          <span className="font-medium">
            Compare {compareSelection.length}/2
          </span>
          {compareWorkflowMismatch && (
            <span className="text-yellow-600 dark:text-yellow-400">
              same workflow only
            </span>
          )}
          <Button
            size="sm"
            variant={canCompare ? "default" : "ghost"}
            className="ml-auto h-6 text-xs"
            disabled={!canCompare}
            onClick={() =>
              onCompareRuns(compareSelection[0]!, compareSelection[1]!)
            }
          >
            Compare
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() => setCompareSelection([])}
          >
            Clear
          </Button>
        </section>
      )}

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
              compareSelected={compareSelection.includes(r.id)}
              onClick={() => onRunSelect(r.id)}
              onToggleCompare={() => toggleCompare(r.id)}
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
  compareSelected,
  onClick,
  onToggleCompare,
  onRetry,
}: {
  run: WorkflowRunSummary;
  compareSelected: boolean;
  onClick: () => void;
  onToggleCompare: () => void;
  onRetry: () => void;
}) {
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
    <div
      className={`group flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent ${
        compareSelected ? "ring-1 ring-primary" : ""
      }`}
    >
      <input
        type="checkbox"
        className="h-3 w-3 cursor-pointer"
        aria-label={`Mark ${run.workflow} run ${run.id.slice(0, 8)} for comparison`}
        checked={compareSelected}
        onChange={onToggleCompare}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        className="flex flex-1 items-center gap-1.5 text-left"
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
      </button>
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
    </div>
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
