export type RepairFailureOutput = {
  id: string;
};

export type RepairIterationOutput = {
  failures: RepairFailureOutput[];
  agentCostUsd?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRepairFailures(value: unknown): RepairFailureOutput[] {
  if (!Array.isArray(value)) return [];
  const failures: RepairFailureOutput[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) continue;
    failures.push({ id });
  }
  return failures;
}

export function readRepairIterations(output: unknown): RepairIterationOutput[] {
  if (!isRecord(output)) return [];
  const raw = output.repairIterations;
  if (!Array.isArray(raw)) return [];
  const iterations: RepairIterationOutput[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    iterations.push({
      failures: readRepairFailures(item.failures),
      ...(typeof item.agentCostUsd === "number" ? { agentCostUsd: item.agentCostUsd } : {}),
    });
  }
  return iterations;
}
