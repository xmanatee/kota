import { api } from "@/api/client";
import { queryKeys, workflowRunQuery } from "@/api/queries";
import type { WorkflowRunStepSummary } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useProjectId } from "@/lib/project-context";
import { fmtDuration, renderMarkdown } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function RunDetail({
  runId,
  onClose,
}: { runId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const projectId = useProjectId();
  const { data: run, isLoading } = useQuery({
    ...workflowRunQuery(runId, projectId),
    refetchInterval: 5000,
  });

  const abortMutation = useMutation({
    mutationFn: () => api.abortWorkflowRun(runId, projectId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workflowRun(runId, projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.workflowStatus(projectId),
      });
    },
  });

  if (isLoading || !run) {
    return (
      <div className="flex h-full flex-col">
        <Header runId={runId} onClose={onClose} />
        <div className="flex-1 p-4 text-sm text-muted-foreground">
          Loading...
        </div>
      </div>
    );
  }

  const isActive = run.status === "running";
  const statusVariant =
    run.status === "success"
      ? ("success" as const)
      : run.status === "failed"
        ? ("destructive" as const)
        : run.status === "completed-with-warnings"
          ? ("warning" as const)
          : run.status === "running"
            ? ("running" as const)
            : ("secondary" as const);

  return (
    <div className="flex h-full flex-col">
      <Header runId={runId} onClose={onClose}>
        <Badge variant={statusVariant}>{run.status}</Badge>
        {isActive && (
          <Button
            size="sm"
            variant="destructive"
            className="h-6 text-xs"
            onClick={() => abortMutation.mutate()}
          >
            Abort
          </Button>
        )}
      </Header>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-4 space-y-1 text-xs">
          <Row label="Workflow" value={run.workflow} />
          <Row label="Trigger" value={run.triggerEvent} />
          <Row
            label="Started"
            value={new Date(run.startedAt).toLocaleString()}
          />
          {run.completedAt && (
            <Row
              label="Completed"
              value={new Date(run.completedAt).toLocaleString()}
            />
          )}
          {run.durationMs != null && (
            <Row label="Duration" value={fmtDuration(run.durationMs)} />
          )}
          {run.totalCostUsd != null && (
            <Row label="Cost" value={`$${run.totalCostUsd.toFixed(4)}`} />
          )}
          {run.tags && run.tags.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">Tags</span>
              {run.tags.map((t) => (
                <Badge key={t} variant="outline" className="text-[10px]">
                  {t}
                </Badge>
              ))}
            </div>
          )}
          {run.causedBy && (
            <Row
              label="Caused by"
              value={`${run.causedBy.workflow} (${run.causedBy.runId.slice(0, 12)})`}
            />
          )}
        </div>

        {run.warnings && run.warnings.length > 0 && (
          <div className="mb-4 space-y-1">
            {run.warnings.map((w, i) => (
              <div
                key={i}
                className="rounded border border-yellow-500/30 bg-yellow-500/5 px-3 py-1.5 text-xs text-yellow-600 dark:text-yellow-400"
              >
                <span className="font-medium">{w.type}:</span> {w.message}
              </div>
            ))}
          </div>
        )}

        {run.triggerPayload && Object.keys(run.triggerPayload).length > 0 && (
          <details className="mb-4">
            <summary className="cursor-pointer text-xs font-medium">
              Trigger Payload
            </summary>
            <pre className="mt-1 overflow-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify(run.triggerPayload, null, 2)}
            </pre>
          </details>
        )}

        <h4 className="mb-2 text-xs font-medium">Steps</h4>
        <div className="space-y-2">
          {run.steps.map((step) => (
            <StepItem key={step.id} step={step} />
          ))}
          {run.steps.length === 0 && (
            <div className="text-xs text-muted-foreground">No steps</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Header({
  runId,
  onClose,
  children,
}: { runId: string; onClose: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2">
      <Button variant="ghost" size="sm" onClick={onClose}>
        \u2190
      </Button>
      <span className="flex-1 truncate text-xs font-mono text-muted-foreground">
        {runId.slice(0, 30)}
      </span>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}

function StepItem({ step }: { step: WorkflowRunStepSummary }) {
  const statusVariant =
    step.status === "success"
      ? ("success" as const)
      : step.status === "failed"
        ? ("destructive" as const)
        : step.status === "running"
          ? ("running" as const)
          : ("secondary" as const);

  return (
    <div className="rounded border border-border p-2">
      <div className="flex items-center gap-1.5 text-xs">
        <Badge variant={statusVariant} className="h-4 px-1.5 text-[10px]">
          {step.status}
        </Badge>
        <span className="flex-1 truncate font-medium">{step.id}</span>
        <span className="text-muted-foreground">{step.type}</span>
        {step.durationMs > 0 && (
          <span className="text-muted-foreground">
            {fmtDuration(step.durationMs)}
          </span>
        )}
        {step.costUsd != null && (
          <span className="text-muted-foreground">
            ${step.costUsd.toFixed(4)}
          </span>
        )}
      </div>
      {step.error && (
        <div className="mt-1 text-xs">
          <div
            className="prose prose-xs dark:prose-invert max-w-none text-destructive"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(step.error) }}
          />
        </div>
      )}
      {step.toolCalls && step.toolCalls.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {step.toolCalls.map((tc) => (
            <Badge key={tc.tool} variant="outline" className="text-[10px]">
              {tc.tool} x{tc.count}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
