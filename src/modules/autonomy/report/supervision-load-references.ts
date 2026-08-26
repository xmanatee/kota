import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { reportRunTriggerPayload } from "#modules/autonomy/run-delivery-evidence.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { PostCompletionFollowUpReport } from "./post-completion-followups.js";
import {
  builderTaskAssociation,
  scopeFromPayload,
  taskIdFromText,
} from "./supervision-load-json.js";
import {
  type ApprovalRecord,
  type AttentionRecord,
  type DeadLetterRecord,
  type OwnerQuestionRecord,
  type SupervisionLoadReference,
  TOP_REFERENCE_LIMIT,
} from "./supervision-load-types.js";

export function buildTopReferences(input: {
  activeRuns: readonly WorkflowRunMetadata[];
  approvals: readonly ApprovalRecord[];
  ownerQuestions: readonly OwnerQuestionRecord[];
  deadLetters: readonly DeadLetterRecord[];
  attentionItems: readonly AttentionRecord[];
  postCompletionFollowUps: PostCompletionFollowUpReport;
  taskById: ReadonlyMap<string, RepoTaskFullRecord>;
}): SupervisionLoadReference[] {
  return [
    ...activeRunReferences(input.activeRuns, input.taskById),
    ...approvalReferences(input.approvals),
    ...ownerQuestionReferences(input.ownerQuestions, input.taskById),
    ...deadLetterReferences(input.deadLetters),
    ...attentionReferences(input.attentionItems),
    ...followUpReferences(input.postCompletionFollowUps),
  ].slice(0, TOP_REFERENCE_LIMIT);
}

function activeRunReferences(
  activeRuns: readonly WorkflowRunMetadata[],
  taskById: ReadonlyMap<string, RepoTaskFullRecord>,
): SupervisionLoadReference[] {
  return activeRuns.map((run) => {
    const payload = reportRunTriggerPayload(run);
    if (payload === null) {
      throw new Error(`Malformed current workflow run "${run.id}": missing trigger`);
    }
    const taskAssociation = builderTaskAssociation(run, taskById);
    const scope = scopeFromPayload(payload);
    return {
      kind: "active-run",
      id: run.id,
      reason: `running ${run.workflow}`,
      workflow: run.workflow,
      taskId: taskAssociation?.taskId ?? null,
      taskTitle: taskAssociation?.task?.title ?? null,
      scopeId: scope.scopeId,
      projectId: scope.projectId,
    };
  });
}

function approvalReferences(
  approvals: readonly ApprovalRecord[],
): SupervisionLoadReference[] {
  return approvals
    .filter((item) => item.status === "pending")
    .map((approval) => ({
      kind: "approval",
      id: approval.id,
      reason: `${approval.tool} approval (${approval.risk})`,
      workflow: null,
      taskId: null,
      taskTitle: null,
      scopeId: null,
      projectId: null,
    }));
}

function ownerQuestionReferences(
  questions: readonly OwnerQuestionRecord[],
  taskById: ReadonlyMap<string, RepoTaskFullRecord>,
): SupervisionLoadReference[] {
  return questions
    .filter((item) => item.status === "pending")
    .map((question) => ({
      kind: "owner-question",
      id: question.id,
      reason: "pending owner question",
      workflow: question.workflow,
      taskId: question.taskId,
      taskTitle: question.taskId
        ? taskById.get(question.taskId)?.title ?? null
        : null,
      scopeId: null,
      projectId: null,
    }));
}

function deadLetterReferences(
  deadLetters: readonly DeadLetterRecord[],
): SupervisionLoadReference[] {
  return deadLetters
    .filter((entry) => entry.status === "open")
    .map((item) => ({
      kind: "dead-letter",
      id: item.id,
      reason: `${item.type} dead letter`,
      workflow: item.workflows[0] ?? null,
      taskId: null,
      taskTitle: null,
      scopeId: item.scopeId,
      projectId: item.projectId,
    }));
}

function attentionReferences(
  attentionItems: readonly AttentionRecord[],
): SupervisionLoadReference[] {
  return attentionItems.map((item) => ({
    kind: "attention-item",
    id: item.id,
    reason: `${item.label}: ${item.detail}`,
    workflow: null,
    taskId: taskIdFromText(item.detail),
    taskTitle: null,
    scopeId: null,
    projectId: null,
  }));
}

function followUpReferences(
  postCompletionFollowUps: PostCompletionFollowUpReport,
): SupervisionLoadReference[] {
  return postCompletionFollowUps.links.map((link) => ({
    kind: "post-completion-follow-up",
    id: link.activeFollowUpTaskId,
    reason: `follow-up for ${link.completedTaskId}`,
    workflow: null,
    taskId: link.activeFollowUpTaskId,
    taskTitle: link.activeFollowUpTitle,
    scopeId: null,
    projectId: null,
  }));
}
