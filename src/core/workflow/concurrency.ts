export const DEFAULT_WORKFLOW_CONCURRENCY = 4;
export const MAX_WORKFLOW_CONCURRENCY = 1_000;

export function isWorkflowConcurrency(value: unknown): value is number {
  return Number.isSafeInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= MAX_WORKFLOW_CONCURRENCY;
}

export function resolveWorkflowConcurrency(config?: { concurrency?: number }): number {
  const value = config?.concurrency;
  if (value === undefined) return DEFAULT_WORKFLOW_CONCURRENCY;
  if (!isWorkflowConcurrency(value)) {
    throw new Error(
      `Workflow concurrency must be an integer from 1 to ${MAX_WORKFLOW_CONCURRENCY}`,
    );
  }
  return value;
}
