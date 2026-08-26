import { join, relative } from "node:path";
import {
  type ActiveWorkflowRunHandle,
  createActiveRunHandle,
} from "./active-run-handle.js";
import {
  projectWorkflowRunMetadataForStorage,
  projectWorkflowRunTriggerForStorage,
} from "./run-evidence.js";
import {
  ensureDir,
  formatRunId,
  validateWorkflowRunId,
  workflowRunIdFromPayload,
  writeJsonFile,
} from "./run-io.js";
import { buildWorkflowSnapshot } from "./run-store-snapshot.js";
import { buildStepOrder } from "./run-store-step-order.js";
import type {
  WorkflowRunMetadata,
} from "./run-types.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

export function createWorkflowRun(opts: {
  scopeRoot: string;
  runsDir: string;
  workflow: WorkflowDefinition;
  trigger: WorkflowRunTrigger;
  runId: string | undefined;
  headSha: string | null;
}): ActiveWorkflowRunHandle {
  const payloadRunId =
    typeof opts.trigger.payload._runId === "string"
      ? opts.trigger.payload._runId
      : undefined;
  const id = opts.runId !== undefined
    ? validateWorkflowRunId(opts.runId, `Workflow "${opts.workflow.name}" queued`)
    : workflowRunIdFromPayload(
      payloadRunId,
      `Workflow "${opts.workflow.name}" trigger`,
    ) ?? formatRunId(opts.workflow.name);
  const runDirPath = join(opts.runsDir, id);
  ensureDir(runDirPath);
  ensureDir(join(runDirPath, "steps"));

  const metadata = buildRunMetadata({
    scopeRoot: opts.scopeRoot,
    runDirPath,
    id,
    workflow: opts.workflow,
    trigger: opts.trigger,
  });

  writeJsonFile(join(runDirPath, "workflow.json"), buildWorkflowSnapshot(opts.workflow));
  writeJsonFile(
    join(runDirPath, "trigger.json"),
    projectWorkflowRunTriggerForStorage(opts.trigger),
  );
  writeJsonFile(
    join(runDirPath, "metadata.json"),
    projectWorkflowRunMetadataForStorage(metadata),
  );

  return createActiveRunHandle({
    id,
    scopeRoot: opts.scopeRoot,
    runDirPath,
    metadata,
    headSha: opts.headSha,
    stepOrder: buildStepOrder(opts.workflow.steps),
  });
}

function buildRunMetadata(opts: {
  scopeRoot: string;
  runDirPath: string;
  id: string;
  workflow: WorkflowDefinition;
  trigger: WorkflowRunTrigger;
}): WorkflowRunMetadata {
  const triggeredByRunId =
    typeof opts.trigger.payload.runId === "string"
      ? opts.trigger.payload.runId
      : undefined;
  const causedBy =
    opts.trigger.event === "workflow.completed" &&
    typeof opts.trigger.payload.runId === "string" &&
    typeof opts.trigger.payload.workflow === "string"
      ? {
        runId: opts.trigger.payload.runId,
        workflow: opts.trigger.payload.workflow,
      }
      : undefined;
  const retryOf =
    typeof opts.trigger.payload.retryOf === "string"
      ? opts.trigger.payload.retryOf
      : undefined;
  const resumedFromRunId =
    typeof opts.trigger.payload.resumedFromRunId === "string"
      ? opts.trigger.payload.resumedFromRunId
      : undefined;
  const triggerTags = stringArray(opts.trigger.payload.tags) ?? [];
  const tags = [...new Set([...opts.workflow.tags, ...triggerTags])];

  return {
    id: opts.id,
    workflow: opts.workflow.name,
    definitionPath: opts.workflow.definitionPath,
    trigger: opts.trigger,
    ...(triggeredByRunId !== undefined ? { triggeredByRunId } : {}),
    ...(causedBy !== undefined ? { causedBy } : {}),
    ...(retryOf !== undefined ? { retryOf } : {}),
    ...(resumedFromRunId !== undefined ? { resumedFromRunId } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    startedAt: new Date().toISOString(),
    status: "running",
    runDir: relative(opts.scopeRoot, opts.runDirPath),
    steps: [],
  };
}

function stringArray(value: WorkflowRunTrigger["payload"][string]): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return undefined;
    items.push(item);
  }
  return items;
}
