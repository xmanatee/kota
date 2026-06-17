import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import type { WorkflowBatchFlushPayload } from "#core/workflow/trigger-types.js";
import {
  type AutonomyHealthActionability,
  type AutonomyHealthEvidenceRef,
  type AutonomyHealthSeverity,
  type AutonomyHealthSignal,
  type AutonomyHealthSignalInput,
  autonomyHealthSignal,
  normalizeHealthSignal,
} from "#modules/autonomy/health-signal.js";
import { REPO_TASK_STATES, type RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";

export const AUTONOMY_HEALTH_REVIEW_ARTIFACT = "autonomy-health-review.json";

type TriggerPayload = WorkflowBatchFlushPayload | Record<string, unknown>;

export type AutonomyHealthReviewGroup = {
  dedupeKey: string;
  labels: string[];
  labelsKey: string;
  source: AutonomyHealthSignal["source"];
  severity: AutonomyHealthSeverity;
  actionability: AutonomyHealthActionability;
  signalCount: number;
  signalIds: string[];
  summaries: string[];
  evidenceRefs: AutonomyHealthEvidenceRef[];
  evidenceFingerprint: string;
};

export type AutonomyHealthReview = {
  generatedAt: string;
  trigger: {
    kind: "batch" | "signal";
    sourceEventName: string;
    count: number;
    groupingKey?: string;
    reason?: string;
    scopeId?: string;
    projectId?: string;
  };
  scope: {
    scopeId?: string;
    projectId?: string;
  };
  signals: AutonomyHealthSignal[];
  groups: AutonomyHealthReviewGroup[];
  counts: {
    bySeverity: Record<string, number>;
    byActionability: Record<string, number>;
    byLabel: Record<string, number>;
  };
};

export type AutonomyHealthAppliedAction =
  | {
      kind: "created-task";
      taskId: string;
      path: string;
      dedupeKey: string;
    }
  | {
      kind: "refreshed-task";
      taskId: string;
      path: string;
      dedupeKey: string;
    }
  | {
      kind: "skipped-task";
      taskId: string;
      dedupeKey: string;
      reason: string;
    }
  | {
      kind: "owner-question";
      questionId: string;
      dedupeKey: string;
      question: string;
    }
  | {
      kind: "skipped-owner-question";
      questionId: string;
      dedupeKey: string;
      reason: string;
    }
  | {
      kind: "attention";
      dedupeKey: string;
      reason: string;
    };

export type AutonomyHealthReviewActionResult = {
  createdTaskIds: string[];
  ownerQuestionIds: string[];
  applied: AutonomyHealthAppliedAction[];
  touchedTaskQueue: boolean;
};

export type AutonomyHealthReviewArtifact = {
  generatedAt: string;
  review: AutonomyHealthReview;
  actions: AutonomyHealthReviewActionResult;
};

type TaskAttrs = Record<string, string | string[]>;

const SEVERITY_RANK: Record<AutonomyHealthSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBatchPayload(payload: TriggerPayload): payload is WorkflowBatchFlushPayload {
  return (
    isRecord(payload) &&
    payload.sourceEventName === autonomyHealthSignal.name &&
    Array.isArray(payload.inputEvents)
  );
}

function signalFromUnknown(payload: unknown): AutonomyHealthSignal {
  if (!isRecord(payload)) throw new Error("health signal payload must be an object");
  return normalizeHealthSignal(payload as AutonomyHealthSignalInput);
}

function extractSignals(payload: TriggerPayload): AutonomyHealthSignal[] {
  if (isBatchPayload(payload)) {
    return payload.inputEvents.map((entry) => signalFromUnknown(entry.payload));
  }
  return [signalFromUnknown(payload)];
}

function countBy<T extends string>(
  values: readonly T[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function uniqueEvidenceRefs(
  refs: readonly AutonomyHealthEvidenceRef[],
): AutonomyHealthEvidenceRef[] {
  const byKey = new Map<string, AutonomyHealthEvidenceRef>();
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.ref}`;
    const existing = byKey.get(key);
    if (existing?.summary) continue;
    byKey.set(key, ref);
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.kind}:${a.ref}`.localeCompare(`${b.kind}:${b.ref}`),
  );
}

function maxSeverity(values: readonly AutonomyHealthSeverity[]): AutonomyHealthSeverity {
  return values.reduce<AutonomyHealthSeverity>(
    (max, next) => (SEVERITY_RANK[next] > SEVERITY_RANK[max] ? next : max),
    "info",
  );
}

function primaryActionability(
  values: readonly AutonomyHealthActionability[],
): AutonomyHealthActionability {
  if (values.includes("local-code")) return "local-code";
  if (values.includes("owner-action")) return "owner-action";
  if (values.includes("external-service")) return "external-service";
  return "informational";
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function evidenceFingerprint(
  dedupeKey: string,
  refs: readonly AutonomyHealthEvidenceRef[],
): string {
  return createHash("sha256")
    .update(stableJson({ dedupeKey, refs }))
    .digest("hex")
    .slice(0, 16);
}

function groupSignals(
  signals: readonly AutonomyHealthSignal[],
): AutonomyHealthReviewGroup[] {
  const byDedupe = new Map<string, AutonomyHealthSignal[]>();
  for (const signal of signals) {
    const list = byDedupe.get(signal.dedupeKey) ?? [];
    list.push(signal);
    byDedupe.set(signal.dedupeKey, list);
  }

  return [...byDedupe.entries()]
    .map(([dedupeKey, grouped]) => {
      const labels = uniqueStrings(grouped.flatMap((signal) => signal.labels));
      const evidenceRefs = uniqueEvidenceRefs(
        grouped.flatMap((signal) => signal.evidenceRefs),
      );
      return {
        dedupeKey,
        labels,
        labelsKey: labels.join(","),
        source: grouped[0]!.source,
        severity: maxSeverity(grouped.map((signal) => signal.severity)),
        actionability: primaryActionability(
          grouped.map((signal) => signal.actionability),
        ),
        signalCount: grouped.length,
        signalIds: uniqueStrings(grouped.map((signal) => signal.signalId)),
        summaries: uniqueStrings(grouped.map((signal) => signal.summary)),
        evidenceRefs,
        evidenceFingerprint: evidenceFingerprint(dedupeKey, evidenceRefs),
      } satisfies AutonomyHealthReviewGroup;
    })
    .sort((a, b) => {
      const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (severityDelta !== 0) return severityDelta;
      return a.dedupeKey.localeCompare(b.dedupeKey);
    });
}

export function buildAutonomyHealthReview(args: {
  triggerPayload: TriggerPayload;
  generatedAt: string;
}): AutonomyHealthReview {
  const signals = extractSignals(args.triggerPayload);
  const labels = signals.flatMap((signal) => signal.labels);
  const trigger = isBatchPayload(args.triggerPayload)
    ? {
        kind: "batch" as const,
        sourceEventName: args.triggerPayload.sourceEventName,
        count: args.triggerPayload.count,
        groupingKey: args.triggerPayload.groupingKey,
        reason: args.triggerPayload.reason,
        scopeId: args.triggerPayload.scopeId,
        projectId: args.triggerPayload.projectId,
      }
    : {
        kind: "signal" as const,
        sourceEventName: autonomyHealthSignal.name,
        count: 1,
        scopeId:
          typeof args.triggerPayload.scopeId === "string"
            ? args.triggerPayload.scopeId
            : undefined,
        projectId:
          typeof args.triggerPayload.projectId === "string"
            ? args.triggerPayload.projectId
            : undefined,
      };

  return {
    generatedAt: args.generatedAt,
    trigger,
    scope: {
      ...(trigger.scopeId !== undefined ? { scopeId: trigger.scopeId } : {}),
      ...(trigger.projectId !== undefined ? { projectId: trigger.projectId } : {}),
    },
    signals,
    groups: groupSignals(signals),
    counts: {
      bySeverity: countBy(signals.map((signal) => signal.severity)),
      byActionability: countBy(signals.map((signal) => signal.actionability)),
      byLabel: countBy(labels),
    },
  };
}

function slugFromDedupeKey(dedupeKey: string): string {
  return dedupeKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
}

function taskIdForGroup(group: AutonomyHealthReviewGroup): string {
  return `task-health-${slugFromDedupeKey(group.dedupeKey)}`;
}

function taskPathForId(projectDir: string, state: RepoTaskState, taskId: string): string {
  return join(projectDir, "data", "tasks", state, `${taskId}.md`);
}

function findExistingTask(projectDir: string, taskId: string): {
  state: RepoTaskState;
  path: string;
  raw: string;
} | null {
  for (const state of REPO_TASK_STATES) {
    const path = taskPathForId(projectDir, state, taskId);
    if (!existsSync(path)) continue;
    return { state, path, raw: readFileSync(path, "utf-8") };
  }
  return null;
}

function formatEvidenceRefs(refs: readonly AutonomyHealthEvidenceRef[]): string {
  return refs
    .map((ref) => `- ${ref.kind}: ${ref.ref}${ref.summary ? ` - ${ref.summary}` : ""}`)
    .join("\n");
}

function taskTitle(group: AutonomyHealthReviewGroup): string {
  return `Repair autonomy health pattern ${group.dedupeKey}`;
}

function taskSummary(group: AutonomyHealthReviewGroup): string {
  return (
    `Health signals labeled ${group.labels.join(", ")} repeatedly point at ` +
    `${group.dedupeKey}; investigate and improve the local autonomy protocol, ` +
    "validation, prompt, or module behavior without relying on direct auto-repair."
  );
}

function buildTaskBody(group: AutonomyHealthReviewGroup): string {
  return [
    "",
    `<!-- autonomy-health-dedupe-key: ${group.dedupeKey} -->`,
    `<!-- autonomy-health-evidence-fingerprint: ${group.evidenceFingerprint} -->`,
    "",
    "## Problem",
    "",
    taskSummary(group),
    "",
    `Severity: ${group.severity}`,
    `Actionability: ${group.actionability}`,
    `Labels: ${group.labels.join(", ")}`,
    `Signals: ${group.signalCount}`,
    "",
    "Recent summaries:",
    "",
    ...group.summaries.map((summary) => `- ${summary}`),
    "",
    "## Source / Intent",
    "",
    "Generated by the autonomy health reviewer from typed health signals.",
    "",
    formatEvidenceRefs(group.evidenceRefs),
    "",
    "## Desired Outcome",
    "",
    "The repeated health pattern has a local, evidence-backed repair path. The fix should improve autonomy protocol, prompt, validation, module routing, or runtime behavior that caused the pattern, while preserving the underlying specialized workflows.",
    "",
    "## Product / Safety Link",
    "",
    "This Meta repair protects Product and Safety execution by reducing repeated local autonomy failures, blocked operator paths, missing evidence loops, or validation drift before they consume builder capacity or hide user-facing regressions.",
    "",
    "## Constraints",
    "",
    "- Do not implement direct auto-repair as part of this task unless a separate owner-approved policy enables it.",
    "- Keep health labels extensible; avoid hardcoded workflow-name allowlists.",
    "- Preserve evidence refs in any follow-up artifact or task update.",
    "- Do not expose raw prompts, secrets, tool payloads, or cost-ranking context to autonomy agents.",
    "",
    "## Done When",
    "",
    "- The repeated root cause is identified from the cited health evidence.",
    "- The local autonomy surface emits or consumes health signals more accurately after the repair.",
    "- The relevant workflow, prompt, validator, module, or routing tests prove the regression path.",
    "- The repair avoids duplicate task churn for the same dedupe key.",
    "",
    "## Acceptance Evidence",
    "",
    "- Focused test output covering the repaired health pattern.",
    "- A follow-up `.kota/runs/` artifact, event replay, or reviewer artifact showing the pattern no longer routes incorrectly.",
    "",
  ].join("\n");
}

function serializeTask(group: AutonomyHealthReviewGroup, nowIso: string): string {
  const taskId = taskIdForGroup(group);
  const attrs: TaskAttrs = {
    id: taskId,
    title: taskTitle(group),
    status: "ready",
    priority: group.severity === "critical" ? "p1" : "p2",
    area: "autonomy",
    summary: taskSummary(group),
    created_at: nowIso,
    updated_at: nowIso,
    task_class: "Meta",
  };
  return serializeFlatFrontMatter(attrs, buildTaskBody(group));
}

function shouldCreateLocalRepairTask(group: AutonomyHealthReviewGroup): boolean {
  if (group.actionability !== "local-code") return false;
  return (
    group.severity === "critical" ||
    group.severity === "error" ||
    group.signalCount >= 2
  );
}

function taskAlreadyRecordsEvidence(
  raw: string,
  group: AutonomyHealthReviewGroup,
): boolean {
  return (
    raw.includes(`autonomy-health-evidence-fingerprint: ${group.evidenceFingerprint}`) ||
    group.evidenceRefs.every((ref) => raw.includes(ref.ref))
  );
}

function createOrRefreshTask(args: {
  projectDir: string;
  group: AutonomyHealthReviewGroup;
  nowIso: string;
}): AutonomyHealthAppliedAction {
  const taskId = taskIdForGroup(args.group);
  const existing = findExistingTask(args.projectDir, taskId);
  if (existing) {
    if (taskAlreadyRecordsEvidence(existing.raw, args.group)) {
      return {
        kind: "skipped-task",
        taskId,
        dedupeKey: args.group.dedupeKey,
        reason: "existing task already records this evidence",
      };
    }
    if (existing.state !== "ready") {
      return {
        kind: "skipped-task",
        taskId,
        dedupeKey: args.group.dedupeKey,
        reason: `existing task is ${existing.state}; leaving lifecycle state unchanged`,
      };
    }
    writeFileSync(existing.path, serializeTask(args.group, args.nowIso), "utf-8");
    return {
      kind: "refreshed-task",
      taskId,
      path: relative(args.projectDir, existing.path),
      dedupeKey: args.group.dedupeKey,
    };
  }

  const taskPath = taskPathForId(args.projectDir, "ready", taskId);
  mkdirSync(dirname(taskPath), { recursive: true });
  writeFileSync(taskPath, serializeTask(args.group, args.nowIso), "utf-8");
  return {
    kind: "created-task",
    taskId,
    path: relative(args.projectDir, taskPath),
    dedupeKey: args.group.dedupeKey,
  };
}

function ownerQuestionForGroup(group: AutonomyHealthReviewGroup): string {
  return `Autonomy health pattern ${group.dedupeKey} needs owner/setup action; what should KOTA do next?`;
}

function findPendingOwnerQuestion(
  queue: OwnerQuestionQueue,
  question: string,
): string | null {
  const normalized = question.trim().toLowerCase();
  const existing = queue
    .list("pending")
    .find((item) => item.question.trim().toLowerCase() === normalized);
  return existing?.id ?? null;
}

function enqueueOwnerQuestion(args: {
  projectDir: string;
  runId: string;
  group: AutonomyHealthReviewGroup;
}): AutonomyHealthAppliedAction {
  const queue = new OwnerQuestionQueue(join(args.projectDir, ".kota", "owner-questions"));
  const question = ownerQuestionForGroup(args.group);
  const existingId = findPendingOwnerQuestion(queue, question);
  if (existingId) {
    return {
      kind: "skipped-owner-question",
      questionId: existingId,
      dedupeKey: args.group.dedupeKey,
      reason: `matching pending owner question already exists: ${existingId}`,
    };
  }
  const item = queue.enqueue({
    context:
      `Autonomy health review run ${args.runId} grouped ${args.group.signalCount} signal(s). ` +
      `Labels: ${args.group.labels.join(", ")}. Evidence: ${args.group.evidenceRefs
        .map((ref) => `${ref.kind}:${ref.ref}`)
        .join(", ")}`,
    question,
    reason:
      `${args.group.summaries[0] ?? "Health signal requires owner action."} ` +
      `Actionability is ${args.group.actionability}; local code repair should not be opened automatically.`,
    source: "autonomy-health-reviewer",
    answerBehavior: "record-only",
    origin: {
      kind: "workflow",
      workflowName: "autonomy-health-reviewer",
      runId: args.runId,
      stepId: "apply-actions",
      taskId: null,
    },
    proposedAnswers: [
      "Create a setup or owner-action task",
      "Treat as external/provider noise for now",
      "Escalate to a service/auth repair outside KOTA",
    ],
  });
  return {
    kind: "owner-question",
    questionId: item.id,
    dedupeKey: args.group.dedupeKey,
    question: item.question,
  };
}

function actionTouchesTaskQueue(action: AutonomyHealthAppliedAction): boolean {
  return action.kind === "created-task" || action.kind === "refreshed-task";
}

export function applyAutonomyHealthReviewActions(args: {
  projectDir: string;
  runId: string;
  review: AutonomyHealthReview;
  nowIso: string;
}): AutonomyHealthReviewActionResult {
  const applied = args.review.groups.map((group): AutonomyHealthAppliedAction => {
    if (shouldCreateLocalRepairTask(group)) {
      return createOrRefreshTask({
        projectDir: args.projectDir,
        group,
        nowIso: args.nowIso,
      });
    }
    if (
      group.actionability === "owner-action" ||
      group.actionability === "external-service"
    ) {
      return enqueueOwnerQuestion({
        projectDir: args.projectDir,
        runId: args.runId,
        group,
      });
    }
    return {
      kind: "attention",
      dedupeKey: group.dedupeKey,
      reason:
        group.actionability === "local-code"
          ? "local-code signal has not crossed systemic threshold"
          : "informational health signal recorded without queue action",
    };
  });
  return {
    createdTaskIds: applied
      .filter((action): action is Extract<AutonomyHealthAppliedAction, { kind: "created-task" }> =>
        action.kind === "created-task",
      )
      .map((action) => action.taskId),
    ownerQuestionIds: applied
      .filter((action): action is Extract<AutonomyHealthAppliedAction, { kind: "owner-question" }> =>
        action.kind === "owner-question",
      )
      .map((action) => action.questionId),
    applied,
    touchedTaskQueue: applied.some(actionTouchesTaskQueue),
  };
}

export function writeAutonomyHealthReviewArtifact(
  runDir: string,
  artifact: AutonomyHealthReviewArtifact,
): string {
  mkdirSync(runDir, { recursive: true });
  const artifactPath = join(runDir, AUTONOMY_HEALTH_REVIEW_ARTIFACT);
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
  return artifactPath;
}

export function buildAutonomyHealthAttentionDigest(args: {
  review: AutonomyHealthReview;
  actions: AutonomyHealthReviewActionResult;
}): { items: Array<{ label: string; detail: string }>; text: string } {
  const items = args.review.groups.map((group) => {
    const action = args.actions.applied.find(
      (candidate) => candidate.dedupeKey === group.dedupeKey,
    );
    return {
      label: "Autonomy health",
      detail:
        `${group.severity} ${group.labels.join(", ")} ${group.dedupeKey}; ` +
        `signals ${group.signalCount}; action ${action?.kind ?? "none"}`,
    };
  });
  const text = [
    `Autonomy health review (${items.length} pattern${items.length === 1 ? "" : "s"}):`,
    ...items.map((item) => `• *${item.label}*: ${item.detail}`),
  ].join("\n");
  return { items, text };
}
