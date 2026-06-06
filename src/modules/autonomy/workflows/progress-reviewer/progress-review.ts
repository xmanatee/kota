import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import type { ApprovalStatus, PendingApproval } from "#core/daemon/approval-queue.js";
import {
  type DeadLetterItem,
  type DeadLetterItemType,
  type DeadLetterQueueCounts,
  deadLetterRunArtifactIds,
  deadLetterStoreForProject,
} from "#core/daemon/dead-letter-queue.js";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import {
  deriveDirectoryScopeId,
  GLOBAL_SCOPE_ID,
  loadRegistryFileFromDisk,
} from "#core/daemon/scope-registry.js";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type {
  WorkflowQueuedRun,
  WorkflowRunMetadata,
  WorkflowRuntimeState,
} from "#core/workflow/run-types.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowBatchFlushPayload,
  type WorkflowRunTrigger,
} from "#core/workflow/trigger-types.js";
import {
  getRepoInboxDir,
  getRepoTaskStateDir,
  listFullRepoTasks,
  REPO_TASK_STATES,
  type RepoTaskFullRecord,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { slugifyTaskTitle } from "#modules/repo-tasks/repo-tasks-operations.js";

export const PROGRESS_REVIEW_ARTIFACT = "progress-review.json";
export const PROGRESS_REVIEW_DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const PROGRESS_REVIEW_MAX_RUNS = 20;
export const PROGRESS_REVIEW_MAX_TASKS = 20;
export const PROGRESS_REVIEW_MAX_EVENTS = 30;
export const PROGRESS_REVIEW_MAX_ARTIFACTS = 40;
export const PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH = 6;
export const PROGRESS_REVIEW_MAX_GIT_ENTRIES = 60;
export const PROGRESS_REVIEW_MAX_GIT_STATUS_LINES = 20;
export const PROGRESS_REVIEW_MAX_GIT_COMMITS = 10;
export const PROGRESS_REVIEW_MAX_GIT_FILES_PER_COMMIT = 12;
export const PROGRESS_REVIEW_MAX_APPROVALS = 20;
export const PROGRESS_REVIEW_MAX_DEAD_LETTERS = 20;

export type ProgressReviewTriggerKind =
  | "manual"
  | "schedule"
  | "run-count"
  | "task-count"
  | "message-batch"
  | "event-batch";

export type ProgressReviewScope = {
  kind: "global" | "directory";
  scopeId: string;
  displayName: string;
  directoryRoot?: string;
};

export type ProgressReviewEvidenceRef = {
  id: string;
  kind:
    | "run"
    | "task"
    | "event"
    | "artifact"
    | "git"
    | "owner-question"
    | "approval"
    | "dead-letter";
  summary: string;
  path?: string;
};

export type ProgressReviewRunEvidence = ProgressReviewEvidenceRef & {
  kind: "run";
  workflow: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  triggerEvent?: string;
};

export type ProgressReviewTaskEvidence = ProgressReviewEvidenceRef & {
  kind: "task";
  taskId: string;
  title: string;
  state: RepoTaskState;
  updatedAt: string;
  priority: string;
  area: string;
};

export type ProgressReviewEventEvidence = ProgressReviewEvidenceRef & {
  kind: "event";
  event: string;
  receivedAt: string;
};

export type ProgressReviewArtifactEvidence = ProgressReviewEvidenceRef & {
  kind: "artifact";
  runId: string;
  file: string;
};

export type ProgressReviewGitEvidence =
  | (ProgressReviewEvidenceRef & {
      kind: "git";
      gitKind: "worktree-status";
      statusLine: string;
    })
  | (ProgressReviewEvidenceRef & {
      kind: "git";
      gitKind: "commit";
      commit: string;
      committedAt: string;
    })
  | (ProgressReviewEvidenceRef & {
      kind: "git";
      gitKind: "commit-file";
      commit: string;
      committedAt: string;
      change: string;
      file: string;
    });

export type ProgressReviewOwnerQuestionEvidence = ProgressReviewEvidenceRef & {
  kind: "owner-question";
  questionId: string;
  status: string;
  createdAt: string;
  resolvedAt?: string;
};

export type ProgressReviewApprovalEvidence = ProgressReviewEvidenceRef & {
  kind: "approval";
  approvalId: string;
  status: ApprovalStatus;
  tool: string;
  risk: PendingApproval["risk"];
  reason: string;
  createdAt: string;
  resolvedAt?: string;
  resolutionSource?: string;
};

export type ProgressReviewDeadLetterEvidence = ProgressReviewEvidenceRef & {
  kind: "dead-letter";
  itemId: string;
  itemType: DeadLetterItemType;
  status: "open";
  failureClass: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
  affectedWorkflowNames: string[];
  sourceEventIds: string[];
  redriveAttemptCount: number;
};

export type ProgressReviewDeadLetterCounts = DeadLetterQueueCounts & {
  scopeId: string;
  path: string;
  openItemIds: string[];
  redriveRunIds: string[];
};

export type ProgressReviewEvidencePacket = {
  generatedAt: string;
  triggerKind: ProgressReviewTriggerKind;
  triggerEvent: string;
  scope: ProgressReviewScope;
  window: {
    startedAt: string;
    endedAt: string;
    maxAgeMs: number;
  };
  batch: {
    sourceEventName: string;
    reason: string;
    count: number;
    groupingKey: string;
    droppedInputCount: number;
  } | null;
  runs: ProgressReviewRunEvidence[];
  tasks: ProgressReviewTaskEvidence[];
  events: ProgressReviewEventEvidence[];
  artifacts: ProgressReviewArtifactEvidence[];
  git: ProgressReviewGitEvidence[];
  ownerQuestions: ProgressReviewOwnerQuestionEvidence[];
  approvals: ProgressReviewApprovalEvidence[];
  deadLetterCounts: ProgressReviewDeadLetterCounts[];
  deadLetters: ProgressReviewDeadLetterEvidence[];
  evidence: ProgressReviewEvidenceRef[];
  excluded: string[];
};

const reviewClaimSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
  confidence: z.enum(["low", "medium", "high"]),
}).strict();

const reviewFollowUpTaskSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  priority: z.enum(["p0", "p1", "p2", "p3"]),
  area: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
  acceptanceEvidence: z.string().min(1),
}).strict();

const reviewOwnerQuestionSchema = z.object({
  question: z.string().min(1),
  reason: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
  proposedAnswers: z.array(z.string().min(1)).min(1).optional(),
}).strict();

const progressReviewAgentOutputSchema = z.object({
  verdict: z.enum([
    "on-track",
    "needs-steering",
    "blocked",
    "insufficient-evidence",
  ]),
  summary: z.string().min(1),
  claims: z.array(reviewClaimSchema),
  followUpTasks: z.array(reviewFollowUpTaskSchema),
  ownerQuestions: z.array(reviewOwnerQuestionSchema),
}).strict();

export type ProgressReviewAgentOutput = z.infer<typeof progressReviewAgentOutputSchema>;

export type ProgressReviewAppliedAction =
  | {
      kind: "created-task";
      taskId: string;
      path: string;
      title: string;
    }
  | {
      kind: "skipped-task";
      title: string;
      reason: string;
      existingTaskId?: string;
      existingState?: RepoTaskState | "inbox";
      existingPath?: string;
    }
  | {
      kind: "owner-question";
      questionId: string;
      question: string;
    }
  | {
      kind: "skipped-owner-question";
      question: string;
      reason: string;
    };

export type ProgressReviewActionResult = {
  createdTaskIds: string[];
  ownerQuestionIds: string[];
  applied: ProgressReviewAppliedAction[];
  touchedTaskQueue: boolean;
};

export type ProgressReviewArtifact = {
  generatedAt: string;
  evidence: ProgressReviewEvidencePacket;
  review: ProgressReviewAgentOutput;
  actions: ProgressReviewActionResult;
};

type ProgressReviewRequestPayload = {
  scopeId?: string;
  projectId?: string;
  reason?: string;
  requestedBy?: string;
  windowMs?: number;
};

type TaskAttrs = { [key: string]: string | string[] };

type ProgressReviewDirectorySource = {
  scopeId: string;
  displayName: string;
  projectDir: string;
  idPrefix: string;
};

type ProgressReviewEvidenceTarget = {
  scope: ProgressReviewScope;
  sources: ProgressReviewDirectorySource[];
};

type ScopedRunEvidence = {
  source: ProgressReviewDirectorySource;
  runId: string;
  startedMs: number;
  evidence: ProgressReviewRunEvidence;
};

type RunArtifactListing = {
  files: string[];
  hitFileLimit: boolean;
  hitDepthLimit: boolean;
};

type ExistingWorkItem = {
  id: string;
  state: RepoTaskState | "inbox";
  path: string;
};

function nonEmptyString(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value.trim() : null;
}

function readWindowMs(payload: ProgressReviewRequestPayload): number {
  if (payload.windowMs === undefined) return PROGRESS_REVIEW_DEFAULT_WINDOW_MS;
  if (!Number.isFinite(payload.windowMs) || payload.windowMs <= 0) {
    throw new Error("progress-review windowMs must be a positive number when provided");
  }
  return Math.floor(payload.windowMs);
}

function requestPayload(trigger: WorkflowRunTrigger): ProgressReviewRequestPayload {
  return trigger.payload as ProgressReviewRequestPayload;
}

function currentDirectorySource(projectDir: string): ProgressReviewDirectorySource {
  return {
    scopeId: deriveDirectoryScopeId(projectDir),
    displayName: basename(projectDir),
    projectDir,
    idPrefix: "",
  };
}

function loadConfiguredDirectorySources(projectDir: string): ProgressReviewDirectorySource[] | null {
  const registry = loadRegistryFileFromDisk(join(projectDir, ".kota"));
  if (!registry) return null;
  return registry.projects.map((project) => ({
    scopeId: project.projectId,
    displayName: project.displayName,
    projectDir: project.projectDir,
    idPrefix: "",
  }));
}

function prefixGlobalSourceIds(
  source: ProgressReviewDirectorySource,
): ProgressReviewDirectorySource {
  return {
    ...source,
    idPrefix: `scope:${source.scopeId}:`,
  };
}

function selectEvidenceTarget(
  projectDir: string,
  trigger: WorkflowRunTrigger,
): ProgressReviewEvidenceTarget {
  const payload = requestPayload(trigger);
  const selected = nonEmptyString(payload.scopeId) ?? nonEmptyString(payload.projectId);
  const currentSource = currentDirectorySource(projectDir);
  const scopeId = selected ?? currentSource.scopeId;
  if (scopeId === GLOBAL_SCOPE_ID) {
    const configured = loadConfiguredDirectorySources(projectDir);
    if (!configured) {
      throw new Error(
        "progress-review global scope requires .kota/project-registry.json",
      );
    }
    return {
      scope: {
        kind: "global",
        scopeId,
        displayName: "Global",
      },
      sources: configured.map(prefixGlobalSourceIds),
    };
  }

  const sources = loadConfiguredDirectorySources(projectDir) ?? [currentSource];
  const source = sources.find((entry) => entry.scopeId === scopeId);
  if (!source) {
    throw new Error(`progress-review scopeId ${scopeId} is not configured`);
  }
  return {
    scope: {
      kind: "directory",
      scopeId,
      displayName: source.displayName,
      directoryRoot: source.projectDir,
    },
    sources: [source],
  };
}

function sourceEvidenceId(source: ProgressReviewDirectorySource, id: string): string {
  return `${source.idPrefix}${id}`;
}

function sourceSummary(source: ProgressReviewDirectorySource, summary: string): string {
  return source.idPrefix ? `[${source.displayName}] ${summary}` : summary;
}

function batchPayload(trigger: WorkflowRunTrigger): WorkflowBatchFlushPayload | null {
  if (trigger.event !== WORKFLOW_BATCH_FLUSH_EVENT) return null;
  const payload = trigger.payload as Partial<WorkflowBatchFlushPayload>;
  if (
    typeof payload.sourceEventName !== "string" ||
    typeof payload.reason !== "string" ||
    typeof payload.count !== "number" ||
    typeof payload.groupingKey !== "string" ||
    !Array.isArray(payload.inputEvents) ||
    !payload.batch
  ) {
    throw new Error("progress-review batch trigger payload is malformed");
  }
  return payload as WorkflowBatchFlushPayload;
}

export function classifyProgressReviewTrigger(
  trigger: WorkflowRunTrigger,
): ProgressReviewTriggerKind {
  if (trigger.event === "autonomy.progress-review.requested") return "manual";
  if (trigger.event === "schedule") return "schedule";
  if (trigger.event === "autonomy.progress-review.scheduled") return "schedule";

  const batch = batchPayload(trigger);
  if (!batch) return "event-batch";
  if (batch.sourceEventName === "workflow.completed") return "run-count";
  if (batch.sourceEventName === "workflow.build.committed") return "task-count";
  if (batch.sourceEventName === "inbound.signal.received") return "message-batch";
  return "event-batch";
}

function readRunTrigger(projectDir: string, runId: string): WorkflowRunTrigger | null {
  return readOptionalJsonFile<WorkflowRunTrigger>(
    join(projectDir, ".kota", "runs", runId, "trigger.json"),
  );
}

function isSafeRunIdBasename(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    value === basename(value) &&
    !value.includes("/") &&
    !value.includes("\\")
  );
}

function validatedMetadataRunId(
  metadata: WorkflowRunMetadata,
  runDirName: string,
): string | null {
  if (!isSafeRunIdBasename(metadata.id)) return null;
  if (metadata.id !== runDirName) return null;
  return metadata.id;
}

function summarizeRun(
  source: ProgressReviewDirectorySource,
  runDirName: string,
  metadata: WorkflowRunMetadata,
): ProgressReviewRunEvidence {
  const trigger = readRunTrigger(source.projectDir, runDirName);
  return {
    id: sourceEvidenceId(source, `run:${runDirName}`),
    kind: "run",
    workflow: metadata.workflow,
    status: metadata.status,
    startedAt: metadata.startedAt,
    ...(metadata.completedAt ? { completedAt: metadata.completedAt } : {}),
    ...(metadata.durationMs !== undefined ? { durationMs: metadata.durationMs } : {}),
    ...(trigger ? { triggerEvent: trigger.event } : {}),
    path: join(".kota", "runs", runDirName, "metadata.json"),
    summary: sourceSummary(
      source,
      `${metadata.workflow} ${metadata.status} (${runDirName})`,
    ),
  };
}

function summarizePendingRun(
  source: ProgressReviewDirectorySource,
  runId: string,
  queued: WorkflowQueuedRun,
): ProgressReviewRunEvidence {
  const queuedAt = new Date(queued.enqueuedAtMs).toISOString();
  const eligibleAt =
    Number.isFinite(queued.notBeforeMs) && queued.notBeforeMs > queued.enqueuedAtMs
      ? `; eligible at ${new Date(queued.notBeforeMs).toISOString()}`
      : "";
  return {
    id: sourceEvidenceId(source, `run:${runId}`),
    kind: "run",
    workflow: queued.workflowName,
    status: "pending",
    startedAt: queuedAt,
    triggerEvent: queued.trigger.event,
    path: join(".kota", "workflow-state.json"),
    summary: sourceSummary(
      source,
      `${queued.workflowName} pending (${runId}) from ${queued.trigger.event}${eligibleAt}`,
    ),
  };
}

function listRecentRuns(
  source: ProgressReviewDirectorySource,
  windowStartMs: number,
  excluded: string[],
): ScopedRunEvidence[] {
  const runsDir = join(source.projectDir, ".kota", "runs");
  if (!existsSync(runsDir)) {
    excluded.push(`${source.displayName} workflow runs: .kota/runs does not exist`);
    return [];
  }

  const runs: ScopedRunEvidence[] = [];
  const entries = readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const entry of entries) {
    const runDirName = entry.name;
    const metadata = readOptionalJsonFile<WorkflowRunMetadata>(
      join(runsDir, runDirName, "metadata.json"),
    );
    if (!metadata) continue;
    const runId = validatedMetadataRunId(metadata, runDirName);
    if (!runId) {
      excluded.push(
        `${source.displayName} workflow run ${runDirName}: metadata id is not a safe basename matching the run directory`,
      );
      continue;
    }
    const startedMs = Date.parse(metadata.startedAt);
    if (!Number.isFinite(startedMs)) continue;
    if (startedMs < windowStartMs) continue;
    runs.push({
      source,
      runId,
      startedMs,
      evidence: summarizeRun(source, runDirName, metadata),
    });
  }
  return runs;
}

function listPendingRuns(
  source: ProgressReviewDirectorySource,
  windowStartMs: number,
  excluded: string[],
): ScopedRunEvidence[] {
  const statePath = join(source.projectDir, ".kota", "workflow-state.json");
  const state = readOptionalJsonFile<WorkflowRuntimeState>(statePath);
  if (!state || !Array.isArray(state.pendingRuns)) return [];

  const pending: ScopedRunEvidence[] = [];
  for (const queued of state.pendingRuns) {
    const enqueuedMs = queued.enqueuedAtMs;
    if (!Number.isFinite(enqueuedMs)) {
      excluded.push(
        `${source.displayName} workflow queue: skipped ${queued.workflowName} with invalid enqueuedAtMs`,
      );
      continue;
    }
    if (enqueuedMs < windowStartMs) continue;
    if (!queued.runId || !isSafeRunIdBasename(queued.runId)) {
      excluded.push(
        `${source.displayName} workflow queue: skipped ${queued.workflowName} pending run with missing or unsafe runId`,
      );
      continue;
    }
    if (existsSync(join(source.projectDir, ".kota", "runs", queued.runId, "metadata.json"))) {
      continue;
    }
    pending.push({
      source,
      runId: queued.runId,
      startedMs: enqueuedMs,
      evidence: summarizePendingRun(source, queued.runId, queued),
    });
  }
  return pending;
}

function listRecentRunsForSources(
  sources: readonly ProgressReviewDirectorySource[],
  windowStartMs: number,
  excluded: string[],
): ScopedRunEvidence[] {
  const runs = sources
    .flatMap((source) => [
      ...listRecentRuns(source, windowStartMs, excluded),
      ...listPendingRuns(source, windowStartMs, excluded),
    ])
    .sort((a, b) => b.startedMs - a.startedMs || a.evidence.id.localeCompare(b.evidence.id));
  if (runs.length > PROGRESS_REVIEW_MAX_RUNS) {
    excluded.push(`workflow runs: truncated after ${PROGRESS_REVIEW_MAX_RUNS} most recent runs`);
  }
  return runs.slice(0, PROGRESS_REVIEW_MAX_RUNS);
}

function summarizeTask(
  source: ProgressReviewDirectorySource,
  record: RepoTaskFullRecord,
): ProgressReviewTaskEvidence {
  return {
    id: sourceEvidenceId(source, `task:${record.id}`),
    kind: "task",
    taskId: record.id,
    title: record.title,
    state: record.state,
    updatedAt: record.updatedAt,
    priority: record.priority,
    area: record.area,
    path: join("data", "tasks", record.state, `${record.id}.md`),
    summary: sourceSummary(source, `${record.id} ${record.state}: ${record.title}`),
  };
}

function listRecentTasks(
  sources: readonly ProgressReviewDirectorySource[],
  windowStartMs: number,
  excluded: string[],
): ProgressReviewTaskEvidence[] {
  const records = sources.flatMap((source) =>
    listFullRepoTasks(source.projectDir)
      .filter((record) => {
        const updatedMs = Date.parse(record.updatedAt);
        return Number.isFinite(updatedMs) && updatedMs >= windowStartMs;
      })
      .map((record) => ({ source, record })),
  );
  records.sort((a, b) => {
    const byUpdated = Date.parse(b.record.updatedAt) - Date.parse(a.record.updatedAt);
    if (byUpdated !== 0) return byUpdated;
    return sourceEvidenceId(a.source, a.record.id).localeCompare(
      sourceEvidenceId(b.source, b.record.id),
    );
  });

  if (records.length > PROGRESS_REVIEW_MAX_TASKS) {
    excluded.push(`tasks: truncated ${records.length} updated tasks to ${PROGRESS_REVIEW_MAX_TASKS}`);
  }
  return records
    .slice(0, PROGRESS_REVIEW_MAX_TASKS)
    .map(({ source, record }) => summarizeTask(source, record));
}

function summarizePayload(value: object): string {
  const text = JSON.stringify(value);
  if (text.length <= 240) return text;
  return `${text.slice(0, 237)}...`;
}

function listBatchEvents(trigger: WorkflowRunTrigger, excluded: string[]): ProgressReviewEventEvidence[] {
  const batch = batchPayload(trigger);
  if (!batch) return [];
  if (batch.inputEvents.length > PROGRESS_REVIEW_MAX_EVENTS) {
    excluded.push(`batch events: truncated ${batch.inputEvents.length} input events to ${PROGRESS_REVIEW_MAX_EVENTS}`);
  }
  return batch.inputEvents.slice(0, PROGRESS_REVIEW_MAX_EVENTS).map((event, index) => ({
    id: `event:${index + 1}`,
    kind: "event",
    event: event.event,
    receivedAt: event.receivedAt,
    summary: `${event.event} at ${event.receivedAt}: ${summarizePayload(event.payload)}`,
  }));
}

function isArtifactFile(relativePath: string): boolean {
  return (
    relativePath !== "metadata.json" &&
    relativePath !== "trigger.json" &&
    relativePath !== "workflow.json"
  );
}

function isPathInside(parent: string, child: string): boolean {
  const fromParent = relative(parent, child);
  return fromParent === "" || (!fromParent.startsWith("..") && !isAbsolute(fromParent));
}

function assertPathInside(parent: string, child: string, label: string): void {
  if (isPathInside(parent, child)) return;
  throw new Error(`${label} escaped progress-review artifact boundary`);
}

function listRunArtifactFiles(runDir: string, maxFiles: number): RunArtifactListing {
  const root = resolve(runDir);
  const files: string[] = [];
  let hitDepthLimit = false;
  function visit(dir: string, relativeParts: string[]): boolean {
    if (files.length >= maxFiles) return true;
    const resolvedDir = resolve(dir);
    assertPathInside(root, resolvedDir, "progress-review artifact directory");
    if (relativeParts.length >= PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH) {
      hitDepthLimit = true;
      return false;
    }
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      if (files.length >= maxFiles) return true;
      const nextParts = [...relativeParts, entry.name];
      const path = resolve(dir, entry.name);
      assertPathInside(root, path, "progress-review artifact path");
      if (nextParts.length > PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH) {
        hitDepthLimit = true;
        continue;
      }
      if (entry.isDirectory()) {
        if (nextParts.length >= PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH) {
          hitDepthLimit = true;
          continue;
        }
        if (visit(path, nextParts)) return true;
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = nextParts.join("/");
      if (isArtifactFile(relativePath)) files.push(relativePath);
    }
    return files.length >= maxFiles;
  }
  const hitFileLimit = visit(root, []);
  return { files: files.sort(), hitFileLimit, hitDepthLimit };
}

function listArtifactEvidence(
  runs: readonly ScopedRunEvidence[],
  excluded: string[],
): ProgressReviewArtifactEvidence[] {
  const artifacts: ProgressReviewArtifactEvidence[] = [];
  for (const run of runs) {
    const runsRoot = resolve(run.source.projectDir, ".kota", "runs");
    const runDir = resolve(runsRoot, run.runId);
    assertPathInside(runsRoot, runDir, "progress-review run directory");
    if (!existsSync(runDir)) continue;
    const remaining = PROGRESS_REVIEW_MAX_ARTIFACTS - artifacts.length;
    const listing = listRunArtifactFiles(runDir, remaining);
    for (const name of listing.files) {
      const path = resolve(runDir, ...name.split("/"));
      assertPathInside(runDir, path, "progress-review artifact path");
      artifacts.push({
        id: sourceEvidenceId(run.source, `artifact:${run.runId}:${name}`),
        kind: "artifact",
        runId: run.runId,
        file: name,
        path: join(".kota", "runs", run.runId, ...name.split("/")),
        summary: sourceSummary(
          run.source,
          `${name} from ${run.evidence.workflow} ${run.evidence.status} (${run.runId})`,
        ),
      });
    }
    if (listing.hitDepthLimit) {
      excluded.push(
        `artifacts for ${run.runId}: skipped entries deeper than ${PROGRESS_REVIEW_MAX_ARTIFACT_DEPTH} path segments`,
      );
    }
    if (listing.hitFileLimit) {
      excluded.push(`artifacts: truncated after ${PROGRESS_REVIEW_MAX_ARTIFACTS} files`);
      return artifacts;
    }
  }
  return artifacts;
}

function gitLines(projectDir: string, args: readonly string[]): string[] {
  const output = execFileSync("git", args, {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return output.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function hasGitHead(projectDir: string): boolean {
  try {
    gitLines(projectDir, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

function shortCommit(commit: string): string {
  return commit.slice(0, 12);
}

function commitTimestamp(unixSeconds: string): string | null {
  const seconds = Number.parseInt(unixSeconds, 10);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

function listGitStatusEvidence(
  source: ProgressReviewDirectorySource,
  excluded: string[],
): ProgressReviewGitEvidence[] {
  try {
    const status = gitLines(source.projectDir, ["status", "--short"]);
    if (status.length > PROGRESS_REVIEW_MAX_GIT_STATUS_LINES) {
      excluded.push(
        `${source.displayName} git status: truncated ${status.length} entries to ${PROGRESS_REVIEW_MAX_GIT_STATUS_LINES}`,
      );
    }
    return status
      .slice(0, PROGRESS_REVIEW_MAX_GIT_STATUS_LINES)
      .map((line, index) => ({
        id: sourceEvidenceId(source, `git:status:${index + 1}`),
        kind: "git" as const,
        gitKind: "worktree-status" as const,
        statusLine: line,
        summary: sourceSummary(source, `worktree ${line}`),
      }));
  } catch {
    excluded.push(`${source.displayName} git: status unavailable`);
    return [];
  }
}

function gitCommitFiles(
  source: ProgressReviewDirectorySource,
  commit: string,
  committedAt: string,
  excluded: string[],
): ProgressReviewGitEvidence[] {
  const short = shortCommit(commit);
  const files = gitLines(source.projectDir, [
    "diff-tree",
    "--root",
    "--no-commit-id",
    "--name-status",
    "-r",
    commit,
  ]);
  if (files.length > PROGRESS_REVIEW_MAX_GIT_FILES_PER_COMMIT) {
    excluded.push(
      `${source.displayName} git commit ${short}: truncated ${files.length} changed files to ${PROGRESS_REVIEW_MAX_GIT_FILES_PER_COMMIT}`,
    );
  }
  return files
    .slice(0, PROGRESS_REVIEW_MAX_GIT_FILES_PER_COMMIT)
    .map((line, index) => {
      const parts = line.split("\t");
      const change = parts[0] ?? "change";
      const file = parts[parts.length - 1] ?? line;
      return {
        id: sourceEvidenceId(source, `git:commit:${short}:file:${index + 1}`),
        kind: "git" as const,
        gitKind: "commit-file" as const,
        commit,
        committedAt,
        change,
        file,
        path: file,
        summary: sourceSummary(source, `commit ${short} ${change} ${file}`),
      };
    });
}

function listGitCommitEvidence(
  source: ProgressReviewDirectorySource,
  windowStartMs: number,
  excluded: string[],
): ProgressReviewGitEvidence[] {
  if (!hasGitHead(source.projectDir)) return [];

  try {
    const since = new Date(windowStartMs).toISOString();
    const commits = gitLines(source.projectDir, [
      "log",
      `--since=${since}`,
      `--max-count=${PROGRESS_REVIEW_MAX_GIT_COMMITS}`,
      "--format=%H%x00%ct%x00%s",
    ]);
    const evidence: ProgressReviewGitEvidence[] = [];
    for (const line of commits) {
      const [commit, unixSeconds, subject] = line.split("\0");
      if (!commit || !unixSeconds || subject === undefined) continue;
      const committedAt = commitTimestamp(unixSeconds);
      if (!committedAt) continue;
      const short = shortCommit(commit);
      evidence.push({
        id: sourceEvidenceId(source, `git:commit:${short}`),
        kind: "git",
        gitKind: "commit",
        commit,
        committedAt,
        summary: sourceSummary(source, `commit ${short}: ${subject}`),
      });
      evidence.push(...gitCommitFiles(source, commit, committedAt, excluded));
    }
    return evidence;
  } catch {
    excluded.push(`${source.displayName} git: recent commits unavailable`);
    return [];
  }
}

function listScopedGitEvidence(
  sources: readonly ProgressReviewDirectorySource[],
  windowStartMs: number,
  excluded: string[],
): ProgressReviewGitEvidence[] {
  const evidence = sources.flatMap((source) => [
    ...listGitStatusEvidence(source, excluded),
    ...listGitCommitEvidence(source, windowStartMs, excluded),
  ]);
  if (evidence.length > PROGRESS_REVIEW_MAX_GIT_ENTRIES) {
    excluded.push(
      `git: truncated ${evidence.length} status and commit entries to ${PROGRESS_REVIEW_MAX_GIT_ENTRIES}`,
    );
  }
  return evidence.slice(0, PROGRESS_REVIEW_MAX_GIT_ENTRIES);
}

type OwnerQuestionFile = {
  id: string;
  status: string;
  question: string;
  reason: string;
  createdAt: string;
  resolvedAt?: string;
};

function ownerQuestionActivityMs(item: OwnerQuestionFile): number | null {
  const timestamp = item.resolvedAt ?? item.createdAt;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function listOwnerQuestionEvidence(
  source: ProgressReviewDirectorySource,
  windowStartMs: number,
  excluded: string[],
): ProgressReviewOwnerQuestionEvidence[] {
  const dir = join(source.projectDir, ".kota", "owner-questions");
  if (!existsSync(dir)) return [];
  const questions: ProgressReviewOwnerQuestionEvidence[] = [];
  for (const file of readdirSync(dir).sort().reverse()) {
    if (!file.endsWith(".json")) continue;
    const item = readOptionalJsonFile<OwnerQuestionFile>(join(dir, file));
    if (!item) continue;
    const activityMs = ownerQuestionActivityMs(item);
    if (activityMs === null || activityMs < windowStartMs) continue;
    questions.push({
      id: sourceEvidenceId(source, `owner-question:${item.id}`),
      kind: "owner-question",
      questionId: item.id,
      status: item.status,
      createdAt: item.createdAt,
      ...(item.resolvedAt ? { resolvedAt: item.resolvedAt } : {}),
      path: join(".kota", "owner-questions", file),
      summary: sourceSummary(source, `${item.status}: ${item.question}`),
    });
    if (questions.length >= 20) {
      excluded.push(`${source.displayName} owner questions: truncated after 20 recent questions`);
      break;
    }
  }
  return questions;
}

function listScopedOwnerQuestionEvidence(
  sources: readonly ProgressReviewDirectorySource[],
  windowStartMs: number,
  excluded: string[],
): ProgressReviewOwnerQuestionEvidence[] {
  return sources.flatMap((source) =>
    listOwnerQuestionEvidence(source, windowStartMs, excluded),
  );
}

type ScopedApprovalEvidence = {
  resolvedOrCreatedMs: number;
  evidence: ProgressReviewApprovalEvidence;
};

function approvalActivityMs(item: PendingApproval): number | null {
  const timestamp = item.resolvedAt ?? item.createdAt;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function approvalSummary(item: PendingApproval): string {
  const resolution =
    item.resolutionSource && item.resolutionSource.trim().length > 0
      ? ` by ${item.resolutionSource}`
      : "";
  return `${item.status}${resolution}: ${item.tool} (${item.risk}) - ${item.reason}`;
}

function summarizeApproval(
  source: ProgressReviewDirectorySource,
  file: string,
  item: PendingApproval,
): ProgressReviewApprovalEvidence {
  return {
    id: sourceEvidenceId(source, `approval:${item.id}`),
    kind: "approval",
    approvalId: item.id,
    status: item.status,
    tool: item.tool,
    risk: item.risk,
    reason: item.reason,
    createdAt: item.createdAt,
    ...(item.resolvedAt ? { resolvedAt: item.resolvedAt } : {}),
    ...(item.resolutionSource ? { resolutionSource: item.resolutionSource } : {}),
    path: join(".kota", "approvals", file),
    summary: sourceSummary(source, approvalSummary(item)),
  };
}

function listApprovalEvidence(
  source: ProgressReviewDirectorySource,
  windowStartMs: number,
): ScopedApprovalEvidence[] {
  const dir = join(source.projectDir, ".kota", "approvals");
  if (!existsSync(dir)) return [];
  const approvals: ScopedApprovalEvidence[] = [];
  for (const file of readdirSync(dir).sort().reverse()) {
    if (!file.endsWith(".json")) continue;
    const item = readOptionalJsonFile<PendingApproval>(join(dir, file));
    if (!item) continue;
    const resolvedOrCreatedMs = approvalActivityMs(item);
    if (resolvedOrCreatedMs === null || resolvedOrCreatedMs < windowStartMs) continue;
    approvals.push({
      resolvedOrCreatedMs,
      evidence: summarizeApproval(source, file, item),
    });
  }
  return approvals;
}

function listScopedApprovalEvidence(
  sources: readonly ProgressReviewDirectorySource[],
  windowStartMs: number,
  excluded: string[],
): ProgressReviewApprovalEvidence[] {
  const approvals = sources
    .flatMap((source) => listApprovalEvidence(source, windowStartMs))
    .sort(
      (a, b) =>
        b.resolvedOrCreatedMs - a.resolvedOrCreatedMs ||
        a.evidence.id.localeCompare(b.evidence.id),
    );
  if (approvals.length > PROGRESS_REVIEW_MAX_APPROVALS) {
    excluded.push(
      `approvals: truncated ${approvals.length} recent approvals to ${PROGRESS_REVIEW_MAX_APPROVALS}`,
    );
  }
  return approvals
    .slice(0, PROGRESS_REVIEW_MAX_APPROVALS)
    .map((approval) => approval.evidence);
}

type ScopedDeadLetterEvidence = {
  updatedMs: number;
  evidence: ProgressReviewDeadLetterEvidence;
};

function deadLetterQueuePath(projectDir: string): string {
  return join(projectDir, ".kota", "dead-letter-queue", "items.json");
}

function emptyDeadLetterCounts(source: ProgressReviewDirectorySource): ProgressReviewDeadLetterCounts {
  return {
    scopeId: source.scopeId,
    path: join(".kota", "dead-letter-queue", "items.json"),
    open: 0,
    dismissed: 0,
    redriven: 0,
    openItemIds: [],
    redriveRunIds: [],
  };
}

function listDeadLetterCounts(
  sources: readonly ProgressReviewDirectorySource[],
): ProgressReviewDeadLetterCounts[] {
  return sources.map((source) => {
    if (!existsSync(deadLetterQueuePath(source.projectDir))) {
      return emptyDeadLetterCounts(source);
    }
    const store = deadLetterStoreForProject(source.projectDir);
    const counts = store.counts(source.scopeId);
    const runArtifacts = deadLetterRunArtifactIds(source.projectDir);
    return {
      scopeId: source.scopeId,
      path: join(".kota", "dead-letter-queue", "items.json"),
      ...counts,
      openItemIds: runArtifacts.itemIds,
      redriveRunIds: runArtifacts.runIds,
    };
  });
}

function deadLetterActivityMs(item: DeadLetterItem): number {
  const parsed = Date.parse(item.updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function deadLetterSummary(item: DeadLetterItem): string {
  const workflows =
    item.affectedWorkflowNames.length > 0
      ? ` for ${item.affectedWorkflowNames.join(", ")}`
      : "";
  return `${item.status} ${item.type}${workflows}: ${item.failure.reason}`;
}

function summarizeDeadLetter(
  source: ProgressReviewDirectorySource,
  item: DeadLetterItem,
): ProgressReviewDeadLetterEvidence {
  return {
    id: sourceEvidenceId(source, `dead-letter:${item.id}`),
    kind: "dead-letter",
    itemId: item.id,
    itemType: item.type,
    status: "open",
    failureClass: item.failure.lastErrorClass,
    reason: item.failure.reason,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    affectedWorkflowNames: item.affectedWorkflowNames,
    sourceEventIds: item.sourceEventIds,
    redriveAttemptCount: item.redriveAttempts.length,
    path: join(".kota", "dead-letter-queue", "items.json"),
    summary: sourceSummary(source, deadLetterSummary(item)),
  };
}

function listDeadLetterEvidence(
  source: ProgressReviewDirectorySource,
): ScopedDeadLetterEvidence[] {
  if (!existsSync(deadLetterQueuePath(source.projectDir))) return [];
  const store = deadLetterStoreForProject(source.projectDir);
  return store.list({ status: "open", scopeId: source.scopeId }).map((item) => ({
    updatedMs: deadLetterActivityMs(item),
    evidence: summarizeDeadLetter(source, item),
  }));
}

function listScopedDeadLetterEvidence(
  sources: readonly ProgressReviewDirectorySource[],
  excluded: string[],
): ProgressReviewDeadLetterEvidence[] {
  const items = sources
    .flatMap((source) => listDeadLetterEvidence(source))
    .sort(
      (a, b) =>
        b.updatedMs - a.updatedMs ||
        a.evidence.id.localeCompare(b.evidence.id),
    );
  if (items.length > PROGRESS_REVIEW_MAX_DEAD_LETTERS) {
    excluded.push(
      `dead letters: truncated ${items.length} open items to ${PROGRESS_REVIEW_MAX_DEAD_LETTERS}`,
    );
  }
  return items
    .slice(0, PROGRESS_REVIEW_MAX_DEAD_LETTERS)
    .map((item) => item.evidence);
}

function toEvidenceRef(evidence: ProgressReviewEvidenceRef): ProgressReviewEvidenceRef {
  return {
    id: evidence.id,
    kind: evidence.kind,
    summary: evidence.summary,
    ...(evidence.path ? { path: evidence.path } : {}),
  };
}

function batchSummary(trigger: WorkflowRunTrigger): ProgressReviewEvidencePacket["batch"] {
  const batch = batchPayload(trigger);
  if (!batch) return null;
  return {
    sourceEventName: batch.sourceEventName,
    reason: batch.reason,
    count: batch.count,
    groupingKey: batch.groupingKey,
    droppedInputCount: batch.batch.droppedInputCount,
  };
}

export function collectProgressReviewEvidence(args: {
  projectDir: string;
  trigger: WorkflowRunTrigger;
  now: Date;
}): ProgressReviewEvidencePacket {
  const payload = requestPayload(args.trigger);
  const windowMs = readWindowMs(payload);
  const endedAt = args.now.toISOString();
  const startedAtMs = args.now.getTime() - windowMs;
  const startedAt = new Date(startedAtMs).toISOString();
  const excluded: string[] = [];
  const target = selectEvidenceTarget(args.projectDir, args.trigger);
  const scopedRuns = listRecentRunsForSources(target.sources, startedAtMs, excluded);
  const runs = scopedRuns.map((run) => run.evidence);
  const tasks = listRecentTasks(target.sources, startedAtMs, excluded);
  const events = listBatchEvents(args.trigger, excluded);
  const artifacts = listArtifactEvidence(scopedRuns, excluded);
  const git = listScopedGitEvidence(target.sources, startedAtMs, excluded);
  const ownerQuestions = listScopedOwnerQuestionEvidence(target.sources, startedAtMs, excluded);
  const approvals = listScopedApprovalEvidence(target.sources, startedAtMs, excluded);
  const deadLetterCounts = listDeadLetterCounts(target.sources);
  const deadLetters = listScopedDeadLetterEvidence(target.sources, excluded);
  const evidence: ProgressReviewEvidenceRef[] = [
    ...runs,
    ...tasks,
    ...events,
    ...artifacts,
    ...git,
    ...ownerQuestions,
    ...approvals,
    ...deadLetters,
  ].map(toEvidenceRef);

  return {
    generatedAt: endedAt,
    triggerKind: classifyProgressReviewTrigger(args.trigger),
    triggerEvent: args.trigger.event,
    scope: target.scope,
    window: {
      startedAt,
      endedAt,
      maxAgeMs: windowMs,
    },
    batch: batchSummary(args.trigger),
    runs,
    tasks,
    events,
    artifacts,
    git,
    ownerQuestions,
    approvals,
    deadLetterCounts,
    deadLetters,
    evidence,
    excluded,
  };
}

export function decodeProgressReviewAgentOutput(
  raw: Parameters<typeof progressReviewAgentOutputSchema.parse>[0],
): ProgressReviewAgentOutput {
  return progressReviewAgentOutputSchema.parse(raw);
}

function evidenceIdsForPacket(packet: ProgressReviewEvidencePacket): Set<string> {
  const ids = new Set<string>();
  for (const evidence of packet.evidence) {
    if (ids.has(evidence.id)) {
      throw new Error(`progress-review evidence packet contains duplicate id: ${evidence.id}`);
    }
    ids.add(evidence.id);
  }
  return ids;
}

function assertKnownEvidenceIds(args: {
  knownIds: ReadonlySet<string>;
  field: string;
  evidenceIds: readonly string[];
}): void {
  const unknown = args.evidenceIds.filter((id) => !args.knownIds.has(id));
  if (unknown.length === 0) return;
  throw new Error(
    `progress-review ${args.field} cites unknown evidence id(s): ${unknown.join(", ")}`,
  );
}

export function validateProgressReviewEvidenceIds(args: {
  evidence: ProgressReviewEvidencePacket;
  review: ProgressReviewAgentOutput;
}): void {
  const knownIds = evidenceIdsForPacket(args.evidence);
  for (const claim of args.review.claims) {
    assertKnownEvidenceIds({
      knownIds,
      field: `claim ${claim.id}`,
      evidenceIds: claim.evidenceIds,
    });
  }
  for (const task of args.review.followUpTasks) {
    assertKnownEvidenceIds({
      knownIds,
      field: `follow-up task "${task.title}"`,
      evidenceIds: task.evidenceIds,
    });
  }
  for (const question of args.review.ownerQuestions) {
    assertKnownEvidenceIds({
      knownIds,
      field: `owner question "${question.question}"`,
      evidenceIds: question.evidenceIds,
    });
  }
}

export function decodeProgressReviewAgentOutputForEvidence(
  raw: Parameters<typeof progressReviewAgentOutputSchema.parse>[0],
  evidence: ProgressReviewEvidencePacket,
): ProgressReviewAgentOutput {
  const review = decodeProgressReviewAgentOutput(raw);
  validateProgressReviewEvidenceIds({ evidence, review });
  return review;
}

function taskPathForId(projectDir: string, state: RepoTaskState, id: string): string {
  return join(getRepoTaskStateDir(projectDir, state), `${id}.md`);
}

function taskRelativePath(state: RepoTaskState, id: string): string {
  return join("data", "tasks", state, `${id}.md`);
}

function findExistingTask(projectDir: string, id: string, title: string): ExistingWorkItem | null {
  for (const state of REPO_TASK_STATES) {
    const candidate = taskPathForId(projectDir, state, id);
    if (existsSync(candidate)) {
      return {
        id,
        state,
        path: taskRelativePath(state, id),
      };
    }
  }

  const normalizedTitle = title.trim().toLowerCase();
  for (const record of listFullRepoTasks(projectDir)) {
    if (record.title.trim().toLowerCase() === normalizedTitle) {
      return {
        id: record.id,
        state: record.state,
        path: taskRelativePath(record.state, record.id),
      };
    }
  }
  const inbox = findExistingInboxEntry(projectDir, id, title);
  if (inbox) return inbox;
  return null;
}

function normalizeRelatedText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function firstMarkdownHeading(body: string): string | null {
  for (const line of body.split(/\r?\n/)) {
    if (line.startsWith("# ")) return line.slice(2).trim();
  }
  return null;
}

function findExistingInboxEntry(
  projectDir: string,
  id: string,
  title: string,
): ExistingWorkItem | null {
  const inboxDir = getRepoInboxDir(projectDir);
  if (!existsSync(inboxDir)) return null;
  const normalizedTitle = normalizeRelatedText(title);
  for (const file of readdirSync(inboxDir).sort()) {
    if (!file.endsWith(".md") || file === "AGENTS.md") continue;
    const path = join(inboxDir, file);
    const inboxId = file.slice(0, -".md".length);
    if (inboxId === id) {
      return { id: inboxId, state: "inbox", path: join("data", "inbox", file) };
    }
    const raw = readFileSync(path, "utf-8");
    const { attrs, body } = parseFlatFrontMatter(raw);
    const frontmatterTitle = attrs.title;
    const candidates = [
      typeof frontmatterTitle === "string" ? frontmatterTitle : "",
      firstMarkdownHeading(body) ?? "",
      body,
    ];
    if (candidates.some((candidate) => normalizeRelatedText(candidate).includes(normalizedTitle))) {
      return { id: inboxId, state: "inbox", path: join("data", "inbox", file) };
    }
  }
  return null;
}

function stageBestEffort(projectDir: string, path: string): void {
  try {
    execFileSync("git", ["add", path], {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      stdio: "ignore",
    });
  } catch {
    // The workflow commit step stages final tracked changes. In tests and
    // sandboxed runs, the file on disk is still the important mutation.
  }
}

function buildTaskBody(args: {
  runId: string;
  review: ProgressReviewAgentOutput;
  task: ProgressReviewAgentOutput["followUpTasks"][number];
}): string {
  const evidenceIds = args.task.evidenceIds.map((id) => `- ${id}`).join("\n");
  return [
    "",
    "## Problem",
    "",
    args.task.summary,
    "",
    "## Desired Outcome",
    "",
    `Resolve the progress-review finding from run ${args.runId}.`,
    "",
    "## Constraints",
    "",
    "- Preserve the cited evidence ids until the task is resolved.",
    "- Do not treat this seeded task as proof that the finding is already fixed.",
    "",
    "## Done When",
    "",
    "- The cited progress gap is fixed or explicitly disproven with evidence.",
    "- Acceptance evidence is recorded in this task or its run artifact.",
    "",
    "## Source / Intent",
    "",
    `Created by progress-reviewer workflow run ${args.runId}.`,
    "",
    `review verdict: ${args.review.verdict}`,
    `review summary: ${args.review.summary}`,
    "",
    "Evidence ids:",
    "",
    evidenceIds,
    "",
    "## Initiative",
    "",
    "Outcome-aware autonomy progress review.",
    "",
    "## Acceptance Evidence",
    "",
    `- ${args.task.acceptanceEvidence}`,
    "",
  ].join("\n");
}

function writeFollowUpTask(args: {
  projectDir: string;
  runId: string;
  review: ProgressReviewAgentOutput;
  task: ProgressReviewAgentOutput["followUpTasks"][number];
}): ProgressReviewAppliedAction {
  const id = `task-${slugifyTaskTitle(args.task.title)}`;
  if (id === "task-") {
    return {
      kind: "skipped-task",
      title: args.task.title,
      reason: "title produced an empty task slug",
    };
  }
  const existing = findExistingTask(args.projectDir, id, args.task.title);
  if (existing) {
    return {
      kind: "skipped-task",
      title: args.task.title,
      reason: "matching task already exists",
      existingTaskId: existing.id,
      existingState: existing.state,
      existingPath: existing.path,
    };
  }
  const taskPath = taskPathForId(args.projectDir, "ready", id);
  mkdirSync(dirname(taskPath), { recursive: true });
  const now = new Date().toISOString();
  const attrs: TaskAttrs = {
    id,
    title: args.task.title,
    status: "ready",
    priority: args.task.priority,
    area: args.task.area,
    summary: args.task.summary,
    created_at: now,
    updated_at: now,
  };
  writeFileSync(
    taskPath,
    serializeFlatFrontMatter(attrs, buildTaskBody(args)),
    "utf-8",
  );
  stageBestEffort(args.projectDir, taskPath);
  return {
    kind: "created-task",
    taskId: id,
    path: taskPath.slice(args.projectDir.length + 1),
    title: args.task.title,
  };
}

function findPendingOwnerQuestion(queue: OwnerQuestionQueue, question: string): string | null {
  const normalized = question.trim().toLowerCase();
  const existing = queue.list("pending").find(
    (item) => item.question.trim().toLowerCase() === normalized,
  );
  return existing?.id ?? null;
}

function enqueueOwnerQuestion(args: {
  projectDir: string;
  runId: string;
  question: ProgressReviewAgentOutput["ownerQuestions"][number];
}): ProgressReviewAppliedAction {
  const queue = new OwnerQuestionQueue(join(args.projectDir, ".kota", "owner-questions"));
  const existingId = findPendingOwnerQuestion(queue, args.question.question);
  if (existingId) {
    return {
      kind: "skipped-owner-question",
      question: args.question.question,
      reason: `matching pending owner question already exists: ${existingId}`,
    };
  }
  const item = queue.enqueue({
    context: `Progress review run ${args.runId} cited evidence ids: ${args.question.evidenceIds.join(", ")}`,
    question: args.question.question,
    reason: args.question.reason,
    source: "progress-reviewer",
    answerBehavior: "record-only",
    origin: {
      kind: "workflow",
      workflowName: "progress-reviewer",
      runId: args.runId,
      stepId: "apply-actions",
      taskId: null,
    },
    proposedAnswers: args.question.proposedAnswers,
  });
  return {
    kind: "owner-question",
    questionId: item.id,
    question: item.question,
  };
}

export function applyProgressReviewActions(args: {
  projectDir: string;
  runId: string;
  evidence: ProgressReviewEvidencePacket;
  review: ProgressReviewAgentOutput;
}): ProgressReviewActionResult {
  validateProgressReviewEvidenceIds({ evidence: args.evidence, review: args.review });
  const applied: ProgressReviewAppliedAction[] = [];
  for (const task of args.review.followUpTasks) {
    applied.push(writeFollowUpTask({ ...args, task }));
  }
  for (const question of args.review.ownerQuestions) {
    applied.push(enqueueOwnerQuestion({ ...args, question }));
  }
  const createdTaskIds = applied
    .filter((action): action is Extract<ProgressReviewAppliedAction, { kind: "created-task" }> =>
      action.kind === "created-task"
    )
    .map((action) => action.taskId);
  const ownerQuestionIds = applied
    .filter((action): action is Extract<ProgressReviewAppliedAction, { kind: "owner-question" }> =>
      action.kind === "owner-question"
    )
    .map((action) => action.questionId);
  return {
    createdTaskIds,
    ownerQuestionIds,
    applied,
    touchedTaskQueue: createdTaskIds.length > 0,
  };
}

export function writeProgressReviewArtifact(
  runDirPath: string,
  artifact: ProgressReviewArtifact,
): string {
  validateProgressReviewEvidenceIds({
    evidence: artifact.evidence,
    review: artifact.review,
  });
  mkdirSync(runDirPath, { recursive: true });
  const artifactPath = join(runDirPath, PROGRESS_REVIEW_ARTIFACT);
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
  return artifactPath;
}

export function readTaskStatus(projectDir: string, id: string): string | null {
  for (const state of REPO_TASK_STATES) {
    const file = taskPathForId(projectDir, state, id);
    if (!existsSync(file)) continue;
    const { attrs } = parseFlatFrontMatter(readFileSync(file, "utf-8"));
    const status = attrs.status;
    return typeof status === "string" ? status : null;
  }
  return null;
}
