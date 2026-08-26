import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import {
  normalizeGeneratedTaskScalar,
  renderGeneratedTaskProse,
} from "#modules/autonomy/generated-task-text.js";
import type {
  GeneratedWorkProposal,
  GeneratedWorkProposalAction,
} from "#modules/autonomy/generated-work-proposal.js";
import { stageGeneratedWorkProposal } from "#modules/autonomy/generated-work-transaction.js";
import {
  type ClassifiedWorkflowGeneratedTask,
  classifyWorkflowGeneratedTask,
} from "#modules/autonomy/workflow-generated-task-class.js";
import { renderRepoTaskIntent } from "#modules/repo-tasks/repo-task-intent.js";
import type {
  ProgressReviewAgentOutput,
  ProgressReviewAppliedAction,
  ProgressReviewFollowUpTaskOutput,
  ProgressReviewOwnerQuestionOutput,
  ProgressReviewResolutionOutput,
} from "./types.js";

function normalizeFrontMatterScalar(field: string, value: string): string {
  return normalizeGeneratedTaskScalar("progress-review follow-up task", field, value);
}

function progressReviewProposalKey(topicKey: string): string {
  const normalized = normalizeGeneratedTaskScalar(
    "progress-review generated work",
    "topic key",
    topicKey,
  ).toLowerCase().replace(/[^a-z0-9:._/-]+/g, "-");
  return `progress-reviewer:${normalized}`;
}

function normalizeFollowUpTask(
  task: ProgressReviewFollowUpTaskOutput,
): ProgressReviewFollowUpTaskOutput {
  return {
    ...task,
    topicKey: normalizeFrontMatterScalar("topic key", task.topicKey),
    title: normalizeFrontMatterScalar("title", task.title),
    area: normalizeFrontMatterScalar("area", task.area),
    summary: normalizeFrontMatterScalar("summary", task.summary),
    evidenceIds: task.evidenceIds.map((id) =>
      normalizeFrontMatterScalar("evidence id", id)
    ),
  };
}

function buildTaskBody(args: {
  review: ProgressReviewAgentOutput;
  task: ProgressReviewFollowUpTaskOutput;
}): string {
  return renderRepoTaskIntent({
    problem: renderGeneratedTaskProse(args.task.summary),
    desiredOutcome:
      `Resolve the progress-review finding identified by topic ` +
      `${args.task.topicKey}.`,
    constraints: [
      "Preserve the cited evidence ids until the task is resolved.",
      "Do not treat this seeded task as proof that the finding is already fixed.",
    ],
    doneWhen: [
      "The cited progress gap is fixed or explicitly disproven with evidence.",
      "The result is supported by proportionate inspectable evidence.",
    ],
    context: [
      "Created by progress-reviewer from the cited evidence.",
      `Review verdict: ${args.review.verdict}`,
      `Review summary: ${renderGeneratedTaskProse(args.review.summary)}`,
      "Evidence ids:",
      ...args.task.evidenceIds,
    ],
    acceptanceEvidence: renderGeneratedTaskProse(args.task.acceptanceEvidence),
  });
}

function taskActionPath(actions: readonly object[]): string | null {
  return actions.find(
    (action): action is Extract<GeneratedWorkProposalAction, { path: string }> =>
      "path" in action,
  )?.path ?? null;
}

export function writeFollowUpTask(args: {
  projectDir: string;
  runId: string;
  review: ProgressReviewAgentOutput;
  task: ProgressReviewFollowUpTaskOutput;
}): ProgressReviewAppliedAction {
  const task = normalizeFollowUpTask(args.task);
  const taskClass = classifyWorkflowGeneratedTask({
    workflowName: "progress-reviewer",
    area: task.area,
    title: task.title,
    summary: task.summary,
  });
  const result = stageGeneratedWorkProposal({
    projectDir: args.projectDir,
    proposal: progressReviewTaskProposal({ ...args, task, taskClass }),
  });
  const created = result.actions.some((action) => action.kind === "created-task");
  const updated = result.actions.some((action) =>
    action.kind === "updated-task" || action.kind === "reopened-task"
  );
  if ((created || updated) && result.taskId) {
    return {
      kind: created ? "created-task" : "updated-task",
      taskId: result.taskId,
      path: taskActionPath(result.actions) ?? `data/tasks/ready/${result.taskId}.md`,
      title: task.title,
    };
  }
  return {
    kind: "skipped-task",
    title: task.title,
    reason: "stable generated-work proposal is current",
    ...(result.taskId
      ? {
        existingTaskId: result.taskId,
        existingState: "ready" as const,
        existingPath: `data/tasks/ready/${result.taskId}.md`,
        existingScopeId: deriveDirectoryScopeId(args.projectDir),
      }
      : {}),
  };
}

export function enqueueOwnerQuestion(args: {
  projectDir: string;
  runId: string;
  question: ProgressReviewOwnerQuestionOutput;
}): ProgressReviewAppliedAction[] {
  const result = stageGeneratedWorkProposal({
    projectDir: args.projectDir,
    proposal: progressReviewOwnerQuestionProposal(args),
  });
  const droppedTasks: ProgressReviewAppliedAction[] = result.actions.flatMap(
    (action) => action.kind === "dropped-task"
      ? [{
        kind: "dropped-task" as const,
        taskId: action.taskId,
        fromState: action.fromState,
      }]
      : [],
  );
  return [...droppedTasks, {
    kind: "owner-question-pending",
    question: args.question.question,
  }];
}

export function resolveGeneratedWork(args: {
  projectDir: string;
  resolution: ProgressReviewResolutionOutput;
}): ProgressReviewAppliedAction[] {
  const result = stageGeneratedWorkProposal({
    projectDir: args.projectDir,
    proposal: progressReviewResolutionProposal(args.resolution),
  });
  return result.actions.map((action): ProgressReviewAppliedAction => {
    if (action.kind === "dropped-task") {
      return {
        kind: "dropped-task",
        taskId: action.taskId,
        fromState: action.fromState,
      };
    }
    if (action.kind === "owner-question-dismissal-pending") {
      return {
        kind: "owner-question-dismissal-pending",
        topicKey: args.resolution.topicKey,
        reason: args.resolution.reason,
      };
    }
    return {
      kind: "resolved-work",
      topicKey: args.resolution.topicKey,
      reason: args.resolution.reason,
    };
  });
}

export function progressReviewTaskProposal(args: {
  runId: string;
  review: ProgressReviewAgentOutput;
  task: ProgressReviewFollowUpTaskOutput;
  taskClass?: ClassifiedWorkflowGeneratedTask;
}): GeneratedWorkProposal {
  const task = normalizeFollowUpTask(args.task);
  const taskClass = args.taskClass ?? classifyWorkflowGeneratedTask({
    workflowName: "progress-reviewer",
    area: task.area,
    title: task.title,
    summary: task.summary,
  });
  return {
    kind: "task",
    proposalKey: progressReviewProposalKey(task.topicKey),
    title: task.title,
    summary: task.summary,
    priority: task.priority,
    area: task.area,
    taskClass,
    body: buildTaskBody({ ...args, task }),
    provenance: {
      source: "progress-reviewer",
      runId: args.runId,
      evidenceRefs: task.evidenceIds,
    },
  };
}

export function progressReviewOwnerQuestionProposal(args: {
  runId: string;
  question: ProgressReviewOwnerQuestionOutput;
}): GeneratedWorkProposal {
  return {
    kind: "owner-question",
    proposalKey: progressReviewProposalKey(args.question.topicKey),
    context:
      "Progress review cited evidence ids: " +
      args.question.evidenceIds.join(", "),
    question: args.question.question,
    reason: args.question.reason,
    proposedAnswers: args.question.proposedAnswers ?? [],
    provenance: {
      source: "progress-reviewer",
      runId: args.runId,
      evidenceRefs: args.question.evidenceIds,
    },
    origin: {
      kind: "workflow",
      workflowName: "progress-reviewer",
      runId: args.runId,
      stepId: "apply-actions",
      taskId: null,
    },
  };
}

export function progressReviewResolutionProposal(
  resolution: ProgressReviewResolutionOutput,
): GeneratedWorkProposal {
  return {
    kind: "none",
    proposalKey: progressReviewProposalKey(resolution.topicKey),
    reason: resolution.reason,
    source: "progress-reviewer",
  };
}
