import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { isDeepStrictEqual } from "node:util";
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
import {
  deriveWorkflowRunCausalProvenance,
  readWorkflowRunMetadataFile,
  WORKFLOW_RUN_METADATA_VERSION,
} from "./run-metadata.js";
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

  const authorityRepair = retainedAuthorityRepairForContinuation({
    metadataPath: join(runDirPath, "metadata.json"),
    id,
    workflow: opts.workflow,
    trigger: opts.trigger,
  });

  const metadata = buildRunMetadata({
    scopeRoot: opts.scopeRoot,
    runDirPath,
    id,
    workflow: opts.workflow,
    trigger: opts.trigger,
    authorityRepair,
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
  authorityRepair: WorkflowRunMetadata["authorityRepair"];
}): WorkflowRunMetadata {
  const causalProvenance = deriveWorkflowRunCausalProvenance(opts.trigger);
  const triggerTags = stringArray(opts.trigger.payload.tags) ?? [];
  const tags = [...new Set([...opts.workflow.tags, ...triggerTags])];

  return {
    metadataVersion: WORKFLOW_RUN_METADATA_VERSION,
    id: opts.id,
    workflow: opts.workflow.name,
    definitionPath: opts.workflow.definitionPath,
    trigger: opts.trigger,
    ...causalProvenance,
    ...(opts.authorityRepair === undefined
      ? {}
      : { authorityRepair: opts.authorityRepair }),
    ...(tags.length > 0 ? { tags } : {}),
    startedAt: new Date().toISOString(),
    status: "running",
    runDir: relative(opts.scopeRoot, opts.runDirPath),
    steps: [],
  };
}

function retainedAuthorityRepairForContinuation(opts: {
  metadataPath: string;
  id: string;
  workflow: WorkflowDefinition;
  trigger: WorkflowRunTrigger;
}): WorkflowRunMetadata["authorityRepair"] {
  if (!existsSync(opts.metadataPath)) return undefined;
  const existing = readWorkflowRunMetadataFile(opts.metadataPath, {
    authorityCritical: true,
    operationallyActive: false,
  });
  if (existing.authorityRepair === undefined) return undefined;
  const projectedTrigger = projectWorkflowRunTriggerForStorage(opts.trigger);
  if (
    existing.id !== opts.id ||
    existing.workflow !== opts.workflow.name ||
    !isDeepStrictEqual(existing.trigger, projectedTrigger)
  ) {
    throw new Error(
      `Cannot continue authority-repaired workflow run "${opts.id}": workflow or trigger authority changed`,
    );
  }
  return existing.authorityRepair;
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
