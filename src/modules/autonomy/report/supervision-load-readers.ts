import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { KotaJsonValue } from "#core/agent-harness/message-protocol.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  listTaskClaimInspections,
  type TaskClaimInspection,
} from "#modules/autonomy/task-claims.js";
import { renderOnDemandAttention } from "#modules/autonomy/workflows/attention-digest/step.js";
import {
  isJsonObject,
  requireObject,
  requireString,
  stringArray,
  stringField,
} from "./supervision-load-json.js";
import type {
  ApprovalRecord,
  AttentionRecord,
  DeadLetterRecord,
  OwnerQuestionRecord,
  StoreResult,
  SupervisionLoadEvidence,
  SupervisionLoadEvidenceSource,
  SupervisionLoadStoreReads,
} from "./supervision-load-types.js";

export function readSupervisionLoadStores(input: {
  projectDir: string;
  runsDir: string;
  runs: readonly WorkflowRunMetadata[];
  windowEndMs: number;
}): SupervisionLoadStoreReads {
  return {
    activeRuns: readActiveRuns(input.runsDir, input.runs),
    taskClaims: readTaskClaims(input.projectDir, input.windowEndMs),
    approvals: readApprovals(input.projectDir),
    ownerQuestions: readOwnerQuestions(input.projectDir),
    deadLetters: readDeadLetters(input.projectDir),
    attentionItems: readAttentionItems(input.projectDir, input.runsDir),
  };
}

function readActiveRuns(
  runsDir: string,
  runs: readonly WorkflowRunMetadata[],
): StoreResult<WorkflowRunMetadata> {
  const evidence = directoryEvidence("active-runs", runsDir);
  if (evidence.status !== "available") return { items: null, evidence };
  return {
    items: runs.filter((run) => run.status === "running"),
    evidence,
  };
}

function readTaskClaims(
  projectDir: string,
  windowEndMs: number,
): StoreResult<TaskClaimInspection> {
  const activeClaimsDir = join(projectDir, ".kota", "task-claims", "active");
  const evidence = directoryEvidence("task-claims", activeClaimsDir);
  if (evidence.status !== "available") return { items: null, evidence };
  try {
    return {
      items: listTaskClaimInspections(projectDir, new Date(windowEndMs)),
      evidence,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      items: null,
      evidence: unreadableEvidence("task-claims", activeClaimsDir, message),
    };
  }
}

function readApprovals(projectDir: string): StoreResult<ApprovalRecord> {
  return readJsonDirectory(
    "approvals",
    join(projectDir, ".kota", "approvals"),
    decodeApprovalRecord,
  );
}

function readOwnerQuestions(
  projectDir: string,
): StoreResult<OwnerQuestionRecord> {
  return readJsonDirectory(
    "owner-questions",
    join(projectDir, ".kota", "owner-questions"),
    decodeOwnerQuestionRecord,
  );
}

function readDeadLetters(projectDir: string): StoreResult<DeadLetterRecord> {
  const path = join(projectDir, ".kota", "dead-letter-queue", "items.json");
  if (!existsSync(path)) {
    return {
      items: null,
      evidence: {
        source: "dead-letters",
        status: "missing",
        path,
        message: "dead-letter store is not available",
      },
    };
  }
  try {
    const raw = readOptionalJsonFile<KotaJsonValue>(path);
    if (!isJsonObject(raw) || !Array.isArray(raw.items)) {
      throw new Error("expected items array");
    }
    return {
      items: raw.items.map((item, index) =>
        decodeDeadLetterRecord(item, `${path}#items[${index}]`),
      ),
      evidence: {
        source: "dead-letters",
        status: "available",
        path,
        message: "dead-letter store read",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      items: null,
      evidence: unreadableEvidence("dead-letters", path, message),
    };
  }
}

function readAttentionItems(
  projectDir: string,
  runsDir: string,
): StoreResult<AttentionRecord> {
  try {
    const rendered = renderOnDemandAttention({ projectDir, runsDir });
    return {
      items: rendered.items.map((item, index) => ({
        id: `attention-${index + 1}`,
        label: item.label,
        detail: item.detail,
      })),
      evidence: {
        source: "attention-items",
        status: "available",
        path: `${projectDir}/data/tasks + ${runsDir}`,
        message: "attention detector read existing task and run surfaces",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      items: null,
      evidence: unreadableEvidence("attention-items", runsDir, message),
    };
  }
}

function readJsonDirectory<TItem>(
  source: SupervisionLoadEvidenceSource,
  dir: string,
  decode: (value: KotaJsonValue, path: string) => TItem,
): StoreResult<TItem> {
  const evidence = directoryEvidence(source, dir);
  if (evidence.status !== "available") return { items: null, evidence };
  try {
    const items = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => {
        const path = join(dir, name);
        const raw = readOptionalJsonFile<KotaJsonValue>(path);
        if (raw === null) {
          throw new Error(`record disappeared while reading ${path}`);
        }
        return decode(raw, path);
      });
    return { items, evidence };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      items: null,
      evidence: unreadableEvidence(source, dir, message),
    };
  }
}

function directoryEvidence(
  source: SupervisionLoadEvidenceSource,
  path: string,
): SupervisionLoadEvidence {
  if (!existsSync(path)) {
    return {
      source,
      status: "missing",
      path,
      message: `${source} store is not available`,
    };
  }
  try {
    readdirSync(path);
    return {
      source,
      status: "available",
      path,
      message: `${source} store read`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return unreadableEvidence(source, path, message);
  }
}

function unreadableEvidence(
  source: SupervisionLoadEvidenceSource,
  path: string,
  message: string,
): SupervisionLoadEvidence {
  return {
    source,
    status: "unreadable",
    path,
    message,
  };
}

function decodeApprovalRecord(
  raw: KotaJsonValue,
  path: string,
): ApprovalRecord {
  const item = requireObject(raw, path);
  return {
    id: requireString(item.id, path, "id"),
    status: requireString(item.status, path, "status"),
    tool: stringField(item.tool) ?? "(unknown tool)",
    risk: stringField(item.risk) ?? "(unknown risk)",
  };
}

function decodeOwnerQuestionRecord(
  raw: KotaJsonValue,
  path: string,
): OwnerQuestionRecord {
  const item = requireObject(raw, path);
  const origin = isJsonObject(item.origin) ? item.origin : null;
  return {
    id: requireString(item.id, path, "id"),
    status: requireString(item.status, path, "status"),
    workflow:
      origin?.kind === "workflow" ? stringField(origin.workflowName) : null,
    runId: origin?.kind === "workflow" ? stringField(origin.runId) : null,
    taskId: origin?.kind === "workflow" ? stringField(origin.taskId) : null,
  };
}

function decodeDeadLetterRecord(
  raw: KotaJsonValue,
  path: string,
): DeadLetterRecord {
  const item = requireObject(raw, path);
  const source = isJsonObject(item.source) ? item.source : null;
  return {
    id: requireString(item.id, path, "id"),
    status: requireString(item.status, path, "status"),
    type: stringField(item.type) ?? "dead-letter",
    workflows: stringArray(item.affectedWorkflowNames),
    scopeId: stringField(item.scopeId),
    projectId: stringField(item.projectId),
    failedRunId: source ? stringField(source.failedRunId) : null,
  };
}
