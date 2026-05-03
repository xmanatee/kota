import { workflowRunQuery } from "@/api/queries";
import type { WorkflowRunDetail } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type RunComparison,
  type StepDiff,
  buildRunComparison,
} from "@/lib/run-diff";
import { fmtDuration } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

const SHORT_ID_LEN = 30;

export function RunCompare({
  runIdA,
  runIdB,
  onClose,
}: { runIdA: string; runIdB: string; onClose: () => void }) {
  const {
    data: runA,
    isLoading: loadingA,
    error: errorA,
  } = useQuery(workflowRunQuery(runIdA));
  const {
    data: runB,
    isLoading: loadingB,
    error: errorB,
  } = useQuery(workflowRunQuery(runIdB));

  if (loadingA || loadingB || !runA || !runB) {
    return (
      <div className="flex h-full flex-col">
        <Header onClose={onClose} title="Compare runs" />
        <div className="flex-1 p-4 text-sm text-muted-foreground">
          {errorA || errorB
            ? `Failed to load runs: ${(errorA ?? errorB)?.toString()}`
            : "Loading..."}
        </div>
      </div>
    );
  }

  if (runA.workflow !== runB.workflow) {
    return (
      <div className="flex h-full flex-col">
        <Header onClose={onClose} title="Compare runs" />
        <div className="flex-1 p-4 text-sm text-destructive">
          Cannot compare runs of different workflows ({runA.workflow} vs{" "}
          {runB.workflow}). Pick two runs of the same workflow.
        </div>
      </div>
    );
  }

  const cmp = buildRunComparison(runA, runB);

  return (
    <div className="flex h-full flex-col">
      <Header onClose={onClose} title={`Compare ${cmp.workflow} runs`} />
      <div className="flex-1 overflow-y-auto p-4">
        <Summary cmp={cmp} runA={runA} runB={runB} />
        <h4 className="mb-2 text-xs font-medium">Steps</h4>
        <DiffTable steps={cmp.steps} />
      </div>
    </div>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2">
      <Button variant="ghost" size="sm" onClick={onClose}>
        ←
      </Button>
      <span className="flex-1 truncate text-xs font-medium">{title}</span>
    </div>
  );
}

function fmtCost(cost: number | null): string {
  return cost === null ? "—" : `$${cost.toFixed(4)}`;
}

function fmtDur(ms: number | null): string {
  return ms === null ? "—" : fmtDuration(ms) || "0ms";
}

function fmtDelta(
  delta: number | null,
  format: (abs: number) => string,
): { text: string; tone: "positive" | "negative" | "neutral" | "muted" } {
  if (delta === null) return { text: "—", tone: "muted" };
  if (delta === 0) return { text: "=", tone: "neutral" };
  const sign = delta > 0 ? "+" : "-";
  const abs = Math.abs(delta);
  return {
    text: `${sign}${format(abs)}`,
    tone: delta > 0 ? "negative" : "positive",
  };
}

function DeltaBadge({
  delta,
  format,
  testId,
}: {
  delta: number | null;
  format: (abs: number) => string;
  testId?: string;
}) {
  const { text, tone } = fmtDelta(delta, format);
  const className =
    tone === "positive"
      ? "text-green-600 dark:text-green-400"
      : tone === "negative"
        ? "text-yellow-600 dark:text-yellow-400"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-muted-foreground";
  return (
    <span className={`tabular-nums ${className}`} data-testid={testId}>
      {text}
    </span>
  );
}

function statusVariant(status: string) {
  if (status === "success") return "success" as const;
  if (status === "failed") return "destructive" as const;
  if (status === "running") return "running" as const;
  if (status === "completed-with-warnings") return "warning" as const;
  return "secondary" as const;
}

function shortId(id: string): string {
  return id.length > SHORT_ID_LEN ? `${id.slice(0, SHORT_ID_LEN)}…` : id;
}

function Summary({
  cmp,
  runA,
  runB,
}: { cmp: RunComparison; runA: WorkflowRunDetail; runB: WorkflowRunDetail }) {
  const costFmt = (n: number) => `$${n.toFixed(4)}`;
  const durFmt = (n: number) => fmtDuration(n) || "0ms";
  return (
    <div className="mb-4 space-y-3">
      <div
        className="grid grid-cols-2 gap-3 text-xs"
        data-testid="run-compare-summary"
      >
        <RunSummaryCard label="Run A" run={runA} />
        <RunSummaryCard label="Run B" run={runB} />
      </div>
      <div
        className={`rounded border px-3 py-2 text-xs ${
          cmp.outcomeChanged
            ? "border-yellow-500/40 bg-yellow-500/5"
            : "border-border"
        }`}
        data-testid="run-compare-outcome"
      >
        <span className="font-medium">Outcome</span>
        {": "}
        {cmp.outcomeChanged ? (
          <>
            <Badge variant={statusVariant(cmp.statusA)} className="text-[10px]">
              {cmp.statusA}
            </Badge>
            <span className="mx-1 text-muted-foreground">→</span>
            <Badge variant={statusVariant(cmp.statusB)} className="text-[10px]">
              {cmp.statusB}
            </Badge>
            <span className="ml-2 text-muted-foreground">outcome changed</span>
          </>
        ) : (
          <>
            <Badge variant={statusVariant(cmp.statusA)} className="text-[10px]">
              {cmp.statusA}
            </Badge>
            <span className="ml-2 text-muted-foreground">unchanged</span>
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <DeltaCard
          label="Total duration"
          a={fmtDur(cmp.totalDurMsA)}
          b={fmtDur(cmp.totalDurMsB)}
          delta={cmp.totalDurDelta}
          format={durFmt}
          testId="run-compare-duration-delta"
        />
        <DeltaCard
          label="Total cost"
          a={fmtCost(cmp.totalCostA)}
          b={fmtCost(cmp.totalCostB)}
          delta={cmp.totalCostDelta}
          format={costFmt}
          testId="run-compare-cost-delta"
        />
      </div>
    </div>
  );
}

function RunSummaryCard({
  label,
  run,
}: { label: string; run: WorkflowRunDetail }) {
  return (
    <div className="rounded border border-border p-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-muted-foreground">{label}</span>
        <Badge variant={statusVariant(run.status)} className="text-[10px]">
          {run.status}
        </Badge>
      </div>
      <div className="font-mono text-[10px] text-muted-foreground">
        {shortId(run.id)}
      </div>
      <div className="mt-1 text-muted-foreground">
        {new Date(run.startedAt).toLocaleString()}
      </div>
    </div>
  );
}

function DeltaCard({
  label,
  a,
  b,
  delta,
  format,
  testId,
}: {
  label: string;
  a: string;
  b: string;
  delta: number | null;
  format: (abs: number) => string;
  testId: string;
}) {
  return (
    <div className="rounded border border-border p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2 tabular-nums">
        <span>{a}</span>
        <span className="text-muted-foreground">→</span>
        <span>{b}</span>
        <span className="ml-auto">
          <DeltaBadge delta={delta} format={format} testId={testId} />
        </span>
      </div>
    </div>
  );
}

function DiffTable({ steps }: { steps: StepDiff[] }) {
  if (steps.length === 0) {
    return <div className="text-xs text-muted-foreground">No steps</div>;
  }
  const costFmt = (n: number) => `$${n.toFixed(4)}`;
  const durFmt = (n: number) => fmtDuration(n) || "0ms";
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full text-xs tabular-nums"
        data-testid="run-compare-step-table"
      >
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1 pr-2 font-medium">Step</th>
            <th className="py-1 pr-2 font-medium">Status</th>
            <th className="py-1 pr-2 font-medium">A dur</th>
            <th className="py-1 pr-2 font-medium">B dur</th>
            <th className="py-1 pr-2 font-medium">Δ dur</th>
            <th className="py-1 pr-2 font-medium">A cost</th>
            <th className="py-1 pr-2 font-medium">B cost</th>
            <th className="py-1 pr-2 font-medium">Δ cost</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step) => {
            const statusChanged = step.statusA !== step.statusB;
            return (
              <tr
                key={step.id}
                className="border-t border-border align-baseline"
                data-testid={`run-compare-step-row-${step.id}`}
              >
                <td className="py-1 pr-2 font-mono">
                  <div className="font-medium">{step.id}</div>
                  {step.type && (
                    <div className="text-[10px] text-muted-foreground">
                      {step.type}
                    </div>
                  )}
                </td>
                <td className="py-1 pr-2">
                  <StatusPair
                    a={step.statusA}
                    b={step.statusB}
                    changed={statusChanged}
                  />
                </td>
                <td className="py-1 pr-2">{fmtDur(step.durMsA)}</td>
                <td className="py-1 pr-2">{fmtDur(step.durMsB)}</td>
                <td className="py-1 pr-2">
                  <DeltaBadge
                    delta={
                      step.durMsA !== null && step.durMsB !== null
                        ? step.durMsB - step.durMsA
                        : null
                    }
                    format={durFmt}
                  />
                </td>
                <td className="py-1 pr-2">{fmtCost(step.costA)}</td>
                <td className="py-1 pr-2">{fmtCost(step.costB)}</td>
                <td className="py-1 pr-2">
                  <DeltaBadge
                    delta={
                      step.costA !== null && step.costB !== null
                        ? step.costB - step.costA
                        : null
                    }
                    format={costFmt}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusPair({
  a,
  b,
  changed,
}: { a: string | null; b: string | null; changed: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      {a === null ? (
        <span className="text-[10px] text-muted-foreground">—</span>
      ) : (
        <Badge variant={statusVariant(a)} className="text-[10px]">
          {a}
        </Badge>
      )}
      <span className="text-[10px] text-muted-foreground">→</span>
      {b === null ? (
        <span className="text-[10px] text-muted-foreground">—</span>
      ) : (
        <Badge variant={statusVariant(b)} className="text-[10px]">
          {b}
        </Badge>
      )}
      {changed && (
        <span className="ml-1 text-[10px] text-yellow-600 dark:text-yellow-400">
          ⚠
        </span>
      )}
    </span>
  );
}
