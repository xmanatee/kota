import { createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  projectWorkflowRunMetadataForStorage,
  projectWorkflowRunTriggerForStorage,
} from "./run-evidence.js";
import { validateWorkflowRunId, writeStrictJsonFile } from "./run-io.js";
import {
  deriveWorkflowRunCausalProvenance,
  isWorkflowRunMetadataAuthorityCriticalState,
  normalizeWorkflowRunMetadata,
  normalizeWorkflowRunTrigger,
  readWorkflowRunMetadataFile,
  type StoredWorkflowRunMetadata,
  WORKFLOW_RUN_METADATA_VERSION,
  WorkflowRunMetadataAuthorityError,
} from "./run-metadata.js";
import type { StoredRun } from "./run-state-types.js";
import type { WorkflowRunMetadataAuthorityRepairEvidence } from "./run-types.js";

export type WorkflowRunMetadataAuthorityRepair = Readonly<{
  kind: "unchanged" | "repaired";
  runId: string;
  metadata: StoredWorkflowRunMetadata;
  backupPath?: string;
  migrations?: readonly string[];
}>;

export type RetainedWorkflowRunMetadataAuthorityRepair = Readonly<{
  runId: string;
  repairedAt: string;
}>;

type JsonObject = Record<string, unknown>;

function jsonObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function authorityFailure(
  initial: WorkflowRunMetadataAuthorityError,
  reason: string,
): WorkflowRunMetadataAuthorityError {
  return new WorkflowRunMetadataAuthorityError({
    ...initial.diagnostic,
    reason,
    recoveryAction:
      "Restore agreement between durable run state, workflow.json, and trigger.json before retrying startup; retained metadata evidence must not be deleted",
  });
}

function readRequiredJson(
  path: string,
  label: string,
  initial: WorkflowRunMetadataAuthorityError,
): Readonly<{ source: string; value: JsonObject }> {
  let source: string;
  let raw: unknown;
  try {
    source = readFileSync(path, "utf8");
    raw = JSON.parse(source) as unknown;
  } catch (error) {
    throw authorityFailure(
      initial,
      `${label} cannot be read as JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const value = jsonObject(raw);
  if (value === null) {
    throw authorityFailure(initial, `${label} must be a JSON object at ${path}`);
  }
  return { source, value };
}

function durableTerminalStatus(run: StoredRun): string | undefined {
  if (run.resultStatus !== undefined) return run.resultStatus;
  if (run.state === "succeeded") return "success";
  if (run.state === "failed") return "failed";
  if (run.state === "cancelled") return "interrupted";
  return undefined;
}

function retainOriginalMetadata(path: string, source: string): string {
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const backupPath = join(
    dirname(path),
    `metadata.pre-authority-repair-${digest}.json`,
  );
  if (!existsSync(backupPath)) {
    copyFileSync(path, backupPath, constants.COPYFILE_EXCL);
  } else if (
    !lstatSync(backupPath).isFile() ||
    readFileSync(backupPath, "utf8") !== source
  ) {
    throw new Error(`Workflow metadata repair backup conflicts at ${backupPath}`);
  }
  return backupPath;
}

const AUTHORITY_REPAIR_BACKUP =
  /^metadata\.pre-authority-repair-([a-f0-9]{16})\.json$/;

/**
 * Resolve the exact run whose metadata caused a fail-closed audit. The source
 * path must point into this store; diagnostic prose alone cannot attribute a
 * repair to a dead letter.
 */
export function workflowRunMetadataAuthorityFailureRunId(args: {
  reason: string;
  runsDir: string;
}): string | null {
  const match =
    /workflow run metadata authority is invalid at (.+?[\\/]metadata\.json): /i.exec(
      args.reason,
    );
  if (match === null) return null;
  const sourcePath = match[1]!;
  const runId = basename(dirname(sourcePath));
  try {
    validateWorkflowRunId(runId, "Workflow metadata authority failure");
  } catch {
    return null;
  }
  return resolve(sourcePath) === resolve(join(args.runsDir, runId, "metadata.json"))
    ? runId
    : null;
}

/**
 * Durable causal proof for dead-letter disposition: the exact run now passes
 * strict authority validation and retains a digest-addressed malformed source
 * written by the runtime-owned repair path.
 */
export function retainedWorkflowRunMetadataAuthorityRepair(args: {
  runsDir: string;
  runId: string;
}): RetainedWorkflowRunMetadataAuthorityRepair | null {
  const runId = validateWorkflowRunId(
    args.runId,
    "Workflow metadata authority repair evidence",
  );
  const runDir = join(args.runsDir, runId);
  let repairEvidence: WorkflowRunMetadataAuthorityRepairEvidence | undefined;
  try {
    repairEvidence = readWorkflowRunMetadataFile(join(runDir, "metadata.json"), {
      authorityCritical: true,
      operationallyActive: false,
    }).authorityRepair;
  } catch {
    return null;
  }
  if (repairEvidence === undefined) return null;

  let entries: string[];
  try {
    entries = readdirSync(runDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    const match = AUTHORITY_REPAIR_BACKUP.exec(entry);
    if (match === null) continue;
    const backupPath = join(runDir, entry);
    let source: string;
    try {
      if (!lstatSync(backupPath).isFile()) continue;
      source = readFileSync(backupPath, "utf8");
    } catch {
      continue;
    }
    const digest = createHash("sha256").update(source).digest("hex");
    if (
      digest.slice(0, 16) !== match[1] ||
      digest !== repairEvidence.originalSha256
    ) continue;
    try {
      readWorkflowRunMetadataFile(backupPath, {
        authorityCritical: true,
        operationallyActive: false,
      });
    } catch (error) {
      if (error instanceof WorkflowRunMetadataAuthorityError) {
        return { runId, repairedAt: repairEvidence.repairedAt };
      }
    }
  }
  return null;
}

/**
 * Repair one malformed run record only when three independent runtime-owned
 * authorities agree: the directory/database identity, workflow snapshot, and
 * projected durable trigger. The invalid record is retained beside the run;
 * any authority disagreement leaves the original fail-closed error intact.
 */
export function repairWorkflowRunMetadataFromDurableAuthority(args: {
  scopeRoot: string;
  runsDir: string;
  run: StoredRun;
}): WorkflowRunMetadataAuthorityRepair {
  const runId = validateWorkflowRunId(
    args.run.id,
    "Durable workflow metadata repair",
  );
  const runDirPath = join(args.runsDir, runId);
  const metadataPath = join(runDirPath, "metadata.json");
  const operationallyActive = isWorkflowRunMetadataAuthorityCriticalState(
    args.run.state,
  );
  let initial: WorkflowRunMetadataAuthorityError;
  try {
    return {
      kind: "unchanged",
      runId,
      metadata: readWorkflowRunMetadataFile(metadataPath, {
        authorityCritical: true,
        operationallyActive,
      }),
    };
  } catch (error) {
    if (!(error instanceof WorkflowRunMetadataAuthorityError)) throw error;
    initial = error;
  }

  const metadataSource = readRequiredJson(
    metadataPath,
    "workflow run metadata",
    initial,
  );
  const rawMetadata = metadataSource.value;
  if (
    rawMetadata.metadataVersion !== undefined &&
    rawMetadata.metadataVersion !== WORKFLOW_RUN_METADATA_VERSION
  ) {
    throw authorityFailure(
      initial,
      `unsupported metadataVersion ${String(rawMetadata.metadataVersion)} cannot be authority-repaired`,
    );
  }

  const workflowPath = join(runDirPath, "workflow.json");
  const workflow = readRequiredJson(
    workflowPath,
    "workflow snapshot",
    initial,
  ).value;
  if (
    typeof workflow.name !== "string" ||
    workflow.name !== args.run.workflow ||
    typeof workflow.definitionPath !== "string"
  ) {
    throw authorityFailure(
      initial,
      `workflow snapshot does not agree with durable workflow ${JSON.stringify(args.run.workflow)}`,
    );
  }

  let durableTrigger: ReturnType<typeof normalizeWorkflowRunTrigger>;
  try {
    durableTrigger = normalizeWorkflowRunTrigger(
      projectWorkflowRunTriggerForStorage(args.run.trigger),
      "durable workflow trigger",
    );
  } catch (error) {
    throw authorityFailure(
      initial,
      error instanceof Error ? error.message : String(error),
    );
  }
  const triggerPath = join(runDirPath, "trigger.json");
  let triggerSnapshot: ReturnType<typeof normalizeWorkflowRunTrigger>;
  try {
    triggerSnapshot = normalizeWorkflowRunTrigger(
      readRequiredJson(triggerPath, "trigger snapshot", initial).value,
      "trigger snapshot",
    );
  } catch (error) {
    if (error instanceof WorkflowRunMetadataAuthorityError) throw error;
    throw authorityFailure(
      initial,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!isDeepStrictEqual(triggerSnapshot, durableTrigger)) {
    throw authorityFailure(
      initial,
      "trigger.json does not agree with the projected durable run trigger",
    );
  }

  const candidate: JsonObject = { ...rawMetadata };
  delete candidate.triggeredByRunId;
  delete candidate.causedBy;
  delete candidate.retryOf;
  delete candidate.resumedFromRunId;
  delete candidate.authorityRepair;
  const originalSha256 = createHash("sha256")
    .update(metadataSource.source)
    .digest("hex");
  Object.assign(candidate, {
    id: runId,
    workflow: args.run.workflow,
    definitionPath: workflow.definitionPath,
    trigger: durableTrigger,
    ...deriveWorkflowRunCausalProvenance(durableTrigger),
    startedAt: args.run.startedAt ?? args.run.admittedAt,
    runDir: relative(args.scopeRoot, runDirPath),
    authorityRepair: {
      repairedAt: new Date().toISOString(),
      originalSha256,
    },
  });
  const terminalStatus = durableTerminalStatus(args.run);
  if (terminalStatus !== undefined) candidate.status = terminalStatus;
  if (
    terminalStatus !== undefined &&
    args.run.finishedAt !== undefined &&
    candidate.completedAt === undefined
  ) {
    candidate.completedAt = args.run.finishedAt;
  }

  const normalized = normalizeWorkflowRunMetadata(candidate, metadataPath, {
    authorityCritical: true,
  });
  if (
    normalized.kind === "invalid-authority" ||
    normalized.kind === "quarantined"
  ) {
    throw authorityFailure(
      initial,
      `authority-reconciled metadata remains invalid: ${normalized.diagnostic.reason}`,
    );
  }

  const backupPath = retainOriginalMetadata(
    metadataPath,
    metadataSource.source,
  );
  writeStrictJsonFile(
    metadataPath,
    projectWorkflowRunMetadataForStorage(normalized.metadata),
  );
  const metadata = readWorkflowRunMetadataFile(metadataPath, {
    authorityCritical: true,
    operationallyActive,
  });
  return {
    kind: "repaired",
    runId,
    metadata,
    backupPath,
    migrations: normalized.kind === "migrated" ? normalized.migrations : [],
  };
}
