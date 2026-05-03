import type { WorkflowRunDetail, WorkflowRunStepSummary } from "@/api/types";

export type StepDiff = {
  id: string;
  type: string | null;
  statusA: string | null;
  statusB: string | null;
  durMsA: number | null;
  durMsB: number | null;
  costA: number | null;
  costB: number | null;
};

export type RunComparison = {
  workflow: string;
  steps: StepDiff[];
  statusA: string;
  statusB: string;
  outcomeChanged: boolean;
  totalCostA: number | null;
  totalCostB: number | null;
  totalCostDelta: number | null;
  totalDurMsA: number | null;
  totalDurMsB: number | null;
  totalDurDelta: number | null;
};

function pickStep(map: Map<string, WorkflowRunStepSummary>, id: string) {
  return map.get(id) ?? null;
}

function num(value: number | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function delta(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : b - a;
}

export function buildRunComparison(
  a: WorkflowRunDetail,
  b: WorkflowRunDetail,
): RunComparison {
  if (a.workflow !== b.workflow) {
    throw new Error(
      `Cannot compare runs of different workflows: ${a.workflow} vs ${b.workflow}`,
    );
  }
  const stepsA = new Map(a.steps.map((s) => [s.id, s]));
  const stepsB = new Map(b.steps.map((s) => [s.id, s]));

  const seen = new Set<string>();
  const steps: StepDiff[] = [];

  for (const step of a.steps) {
    seen.add(step.id);
    const other = pickStep(stepsB, step.id);
    steps.push({
      id: step.id,
      type: step.type,
      statusA: step.status,
      statusB: other?.status ?? null,
      durMsA: step.durationMs,
      durMsB: other?.durationMs ?? null,
      costA: num(step.costUsd),
      costB: num(other?.costUsd),
    });
  }
  for (const step of b.steps) {
    if (seen.has(step.id)) continue;
    const other = pickStep(stepsA, step.id);
    steps.push({
      id: step.id,
      type: step.type,
      statusA: other?.status ?? null,
      statusB: step.status,
      durMsA: other?.durationMs ?? null,
      durMsB: step.durationMs,
      costA: num(other?.costUsd),
      costB: num(step.costUsd),
    });
  }

  return {
    workflow: a.workflow,
    steps,
    statusA: a.status,
    statusB: b.status,
    outcomeChanged: a.status !== b.status,
    totalCostA: num(a.totalCostUsd),
    totalCostB: num(b.totalCostUsd),
    totalCostDelta: delta(num(a.totalCostUsd), num(b.totalCostUsd)),
    totalDurMsA: num(a.durationMs),
    totalDurMsB: num(b.durationMs),
    totalDurDelta: delta(num(a.durationMs), num(b.durationMs)),
  };
}
