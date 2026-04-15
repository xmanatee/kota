import { workflowRunsQuery } from "@/api/queries";
import { useQuery } from "@tanstack/react-query";

export function CostPanel() {
  const { data } = useQuery(workflowRunsQuery({ limit: 50 }));
  const runs = data?.runs ?? [];

  const costByWorkflow = new Map<string, number>();
  let total = 0;
  for (const r of runs) {
    if (r.totalCostUsd != null) {
      total += r.totalCostUsd;
      costByWorkflow.set(
        r.workflow,
        (costByWorkflow.get(r.workflow) ?? 0) + r.totalCostUsd,
      );
    }
  }

  const sorted = [...costByWorkflow.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-1 text-xs">
      <div className="flex justify-between font-medium">
        <span>Total (recent)</span>
        <span>${total.toFixed(3)}</span>
      </div>
      {sorted.map(([wf, cost]) => (
        <div key={wf} className="flex justify-between text-muted-foreground">
          <span className="truncate">{wf}</span>
          <span>${cost.toFixed(3)}</span>
        </div>
      ))}
      {sorted.length === 0 && (
        <div className="text-muted-foreground">No cost data</div>
      )}
    </div>
  );
}
