import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import {
  normalizeGeneratedTaskScalar,
  renderGeneratedTaskProse,
} from "#modules/autonomy/generated-task-text.js";
import {
  type GeneratedWorkProposalAction,
  materializeGeneratedWorkProposal,
} from "#modules/autonomy/generated-work-proposal.js";
import {
  type ClassifiedWorkflowGeneratedTask,
  classifyWorkflowGeneratedTask,
} from "#modules/autonomy/workflow-generated-task-class.js";
import type {
  ProgressReviewAgentOutput,
  ProgressReviewAppliedAction,
  ProgressReviewFollowUpTaskOutput,
  ProgressReviewOwnerQuestionOutput,
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
  taskClass: ClassifiedWorkflowGeneratedTask;
}): string {
  const evidenceIds = args.task.evidenceIds.map((id) => `- ${id}`).join("\n");
  return [
    "",
    "## Problem",
    "",
    renderGeneratedTaskProse(args.task.summary),
    "",
    "## Desired Outcome",
    "",
    `Resolve the progress-review finding identified by topic ${args.task.topicKey}.`,
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
    "Created by progress-reviewer from the cited evidence.",
    "",
    `review verdict: ${args.review.verdict}`,
    "review summary:",
    "",
    renderGeneratedTaskProse(args.review.summary),
    "",
    "Evidence ids:",
    "",
    evidenceIds,
    "",
    ...(args.taskClass === "Meta"
      ? [
        "## Product / Safety Link",
        "",
        "This Meta follow-up protects Product and Safety execution by resolving the progress-review steering gap cited by the evidence ids above before it hides regressions or consumes builder capacity.",
        "",
      ]
      : []),
    "## Initiative",
    "",
    "Outcome-aware autonomy progress review.",
    "",
    "## Acceptance Evidence",
    "",
    "- Review-provided acceptance evidence:",
    "",
    renderGeneratedTaskProse(args.task.acceptanceEvidence),
    "",
  ].join("\n");
}

function taskActionPath(actions: readonly GeneratedWorkProposalAction[]): string | null {
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
  const proposalKey = progressReviewProposalKey(task.topicKey);
  const result = materializeGeneratedWorkProposal({
    projectDir: args.projectDir,
    proposal: {
      kind: "task",
      proposalKey,
      title: task.title,
      summary: task.summary,
      priority: task.priority,
      area: task.area,
      taskClass,
      body: buildTaskBody({ ...args, task, taskClass }),
      provenance: {
        source: "progress-reviewer",
        runId: args.runId,
        evidenceRefs: task.evidenceIds,
      },
    },
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
  const proposalKey = progressReviewProposalKey(args.question.topicKey);
  const result = materializeGeneratedWorkProposal({
    projectDir: args.projectDir,
    proposal: {
      kind: "owner-question",
      proposalKey,
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
    },
  });
  const created = result.actions.some((action) =>
    action.kind === "created-owner-question"
  );
  const updated = result.actions.some((action) =>
    action.kind === "updated-owner-question" ||
    action.kind === "reopened-owner-question"
  );
  const droppedTasks: ProgressReviewAppliedAction[] = result.actions.flatMap(
    (action) => action.kind === "dropped-task"
      ? [{
        kind: "dropped-task" as const,
        taskId: action.taskId,
        fromState: action.fromState,
      }]
      : [],
  );
  if ((created || updated) && result.ownerQuestionId) {
    return [...droppedTasks, {
      kind: created ? "owner-question" : "updated-owner-question",
      questionId: result.ownerQuestionId,
      question: args.question.question,
    }];
  }
  return [...droppedTasks, {
    kind: "skipped-owner-question",
    question: args.question.question,
    reason: "stable generated-work owner question is current",
  }];
}
