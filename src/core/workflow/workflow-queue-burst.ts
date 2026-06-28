import type { KotaConfig } from "#core/config/config.js";
import { formatRunId } from "./run-io.js";
import type { WorkflowQueuedRun } from "./run-types.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export function resolveWorkflowDispatchBurst(input: {
  definition: WorkflowDefinition;
  trigger: WorkflowRunTrigger;
  projectDir: string;
  config: KotaConfig | undefined;
}): number {
  const resolver = input.definition.dispatchBurst;
  const raw =
    typeof resolver === "function"
      ? resolver({
          projectDir: input.projectDir,
          config: input.config,
          workflowName: input.definition.name,
          trigger: input.trigger,
        })
      : resolver;
  if (raw === undefined) return 1;
  if (!Number.isInteger(raw) || raw < 1) return 1;
  return raw;
}

export function burstDispatchSlots(input: {
  dispatchBurst: number;
  queuedSameWorkflow: number;
  activeSameWorkflow: number;
}): number {
  return Math.max(
    0,
    input.dispatchBurst - input.queuedSameWorkflow - input.activeSameWorkflow,
  );
}

export function buildBurstQueuedRuns(input: {
  queuedRun: WorkflowQueuedRun;
  slots: number;
}): WorkflowQueuedRun[] {
  const runs: WorkflowQueuedRun[] = [];
  for (let index = 0; index < input.slots; index += 1) {
    runs.push({
      ...input.queuedRun,
      runId: index === 0 ? input.queuedRun.runId : formatRunId(input.queuedRun.workflowName),
    });
  }
  return runs;
}
