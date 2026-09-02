export type WorkflowRunPruneAuthority = Readonly<{
  protectedRunIds: Set<string>;
  authorityCriticalRunIds: Set<string>;
  operationallyActiveRunIds: Set<string>;
  terminalRunIds: Set<string>;
}>;

/** Consume the canonical durable projection returned by workflow status. */
export function resolveWorkflowRunPruneAuthority(input: Readonly<{
  liveRunIds: Iterable<string>;
  protectedRunIds: Iterable<string> | undefined;
  authorityCriticalRunIds: Iterable<string> | undefined;
  operationallyActiveRunIds: Iterable<string> | undefined;
  terminalRunIds: Iterable<string> | undefined;
}>): WorkflowRunPruneAuthority {
  if (
    input.protectedRunIds === undefined ||
    input.authorityCriticalRunIds === undefined ||
    input.operationallyActiveRunIds === undefined ||
    input.terminalRunIds === undefined
  ) {
    throw new Error(
      "Workflow pruning requires the canonical durable run authority from workflow status",
    );
  }
  const protectedRunIds = new Set(input.liveRunIds);
  for (const runId of input.protectedRunIds) protectedRunIds.add(runId);
  const authorityCriticalRunIds = new Set(input.authorityCriticalRunIds);
  const operationallyActiveRunIds = new Set(input.operationallyActiveRunIds);
  const terminalRunIds = new Set(input.terminalRunIds);

  return {
    protectedRunIds,
    authorityCriticalRunIds,
    operationallyActiveRunIds,
    terminalRunIds,
  };
}
