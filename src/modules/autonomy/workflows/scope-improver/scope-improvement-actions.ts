import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type GeneratedWorkProposalAction,
  materializeGeneratedWorkProposal,
} from "#modules/autonomy/generated-work-proposal.js";
import {
  isScopeImprovementWriteAllowed,
  readScopeImprovementConfig,
  writeScopeImprovementState,
} from "./scope-improvement-state.js";
import {
  SCOPE_IMPROVEMENT_ARTIFACT,
  type ScopeImprovementActionResult,
  type ScopeImprovementAppliedAction,
  type ScopeImprovementArtifact,
  type ScopeImprovementRecommendation,
} from "./scope-improvement-types.js";

function proposalKey(signature: string): string {
  const digest = createHash("sha256").update(signature.trim()).digest("hex").slice(0, 20);
  return `scope-improver:${digest}`;
}

function taskBody(args: {
  runId: string;
  recommendation: Extract<ScopeImprovementRecommendation, { kind: "create-task" }>;
}): string {
  const task = args.recommendation.task;
  return [
    "",
    "## Problem",
    "",
    task.problem,
    "",
    "## Desired Outcome",
    "",
    task.desiredOutcome,
    "",
    "## Constraints",
    "",
    ...task.constraints.map((item) => `- ${item}`),
    "",
    "## Done When",
    "",
    ...task.doneWhen.map((item) => `- ${item}`),
    "",
    "## Source / Intent",
    "",
    `Created by scope-improver workflow run ${args.runId}.`,
    "",
    "Evidence ids:",
    "",
    ...args.recommendation.evidenceIds.map((id) => `- ${id}`),
    "",
    "## Product / Safety Link",
    "",
    "This Meta proposal keeps continuous scope improvement tied to inspectable Product and Safety outcomes instead of introducing a parallel autonomous edit path.",
    "",
    "## Initiative",
    "",
    "Scope-aware continuous improvement.",
    "",
    "## Acceptance Evidence",
    "",
    ...task.acceptanceEvidence.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function taskPath(actions: readonly GeneratedWorkProposalAction[]): string | null {
  return actions.find(
    (action): action is Extract<GeneratedWorkProposalAction, { path: string }> =>
      "path" in action,
  )?.path ?? null;
}

function writeTask(args: {
  projectDir: string;
  runId: string;
  recommendation: Extract<ScopeImprovementRecommendation, { kind: "create-task" }>;
}): ScopeImprovementAppliedAction {
  const result = materializeGeneratedWorkProposal({
    projectDir: args.projectDir,
    proposal: {
      kind: "task",
      proposalKey: proposalKey(args.recommendation.signature),
      title: args.recommendation.title,
      summary: args.recommendation.summary,
      priority: "p2",
      area: "autonomy",
      taskClass: "Meta",
      body: taskBody(args),
      provenance: {
        source: "scope-improver",
        runId: args.runId,
        evidenceRefs: args.recommendation.evidenceIds,
      },
    },
  });
  const created = result.actions.some((action) => action.kind === "created-task");
  const updated = result.actions.some((action) =>
    action.kind === "updated-task" || action.kind === "reopened-task"
  );
  if ((!created && !updated) || !result.taskId) {
    return skipped(args.recommendation.signature, "stable generated-work task is current");
  }
  return {
    kind: created ? "created-task" : "updated-task",
    taskId: result.taskId,
    path: taskPath(result.actions) ?? `data/tasks/ready/${result.taskId}.md`,
    signature: args.recommendation.signature,
  };
}

function writeSafeEdit(args: {
  projectDir: string;
  recommendation: Extract<ScopeImprovementRecommendation, { kind: "safe-edit" }>;
}): ScopeImprovementAppliedAction {
  const config = readScopeImprovementConfig(args.projectDir);
  if (!isScopeImprovementWriteAllowed(config, args.recommendation.path)) {
    return skipped(
      args.recommendation.signature,
      `policy does not allow autonomous edit of ${args.recommendation.path}`,
    );
  }
  const path = join(args.projectDir, args.recommendation.path);
  if (existsSync(path)) {
    return skipped(
      args.recommendation.signature,
      `${args.recommendation.path} already exists`,
    );
  }
  writeFileSync(
    path,
    [
      "# Scope Guidance",
      "",
      "This directory is a KOTA-managed scope.",
      "",
      "- Record durable scope constraints here before broad autonomous improvement work.",
      "- Keep task-specific acceptance evidence in normal KOTA task files or run artifacts.",
      "",
    ].join("\n"),
    "utf-8",
  );
  return {
    kind: "safe-edit",
    path: args.recommendation.path,
    signature: args.recommendation.signature,
  };
}

function enqueueQuestion(args: {
  projectDir: string;
  runId: string;
  recommendation: Extract<ScopeImprovementRecommendation, { kind: "owner-question" }>;
}): ScopeImprovementAppliedAction[] {
  const result = materializeGeneratedWorkProposal({
    projectDir: args.projectDir,
    proposal: {
      kind: "owner-question",
      proposalKey: proposalKey(args.recommendation.signature),
      context:
        `Scope improvement run ${args.runId} cited evidence ids: ` +
        args.recommendation.evidenceIds.join(", "),
      question: args.recommendation.question,
      reason: args.recommendation.reason,
      proposedAnswers: args.recommendation.proposedAnswers,
      provenance: {
        source: "scope-improver",
        runId: args.runId,
        evidenceRefs: args.recommendation.evidenceIds,
      },
      origin: {
        kind: "workflow",
        workflowName: "scope-improver",
        runId: args.runId,
        stepId: "apply-recommendations",
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
  const droppedTasks: ScopeImprovementAppliedAction[] = result.actions.flatMap(
    (action) => action.kind === "dropped-task"
      ? [{
        kind: "dropped-task" as const,
        taskId: action.taskId,
        fromState: action.fromState,
        signature: args.recommendation.signature,
      }]
      : [],
  );
  if ((!created && !updated) || !result.ownerQuestionId) {
    return [
      ...droppedTasks,
      skipped(args.recommendation.signature, "stable owner question is current"),
    ];
  }
  return [...droppedTasks, {
    kind: created ? "owner-question" : "updated-owner-question",
    questionId: result.ownerQuestionId,
    signature: args.recommendation.signature,
  }];
}

function skipped(signature: string, reason: string): ScopeImprovementAppliedAction {
  return { kind: "skipped", signature, reason };
}

export function applyScopeImprovementRecommendations(args: {
  projectDir: string;
  runId: string;
  inputs: ScopeImprovementArtifact["inputs"];
  recommendations: readonly ScopeImprovementRecommendation[];
}): ScopeImprovementActionResult {
  const applied = args.recommendations.flatMap(
    (recommendation): ScopeImprovementAppliedAction[] => {
    if (recommendation.kind === "create-task") {
      return [writeTask({ projectDir: args.projectDir, runId: args.runId, recommendation })];
    }
    if (recommendation.kind === "owner-question") {
      return enqueueQuestion({ projectDir: args.projectDir, runId: args.runId, recommendation });
    }
    if (recommendation.kind === "safe-edit") {
      return [writeSafeEdit({ projectDir: args.projectDir, recommendation })];
    }
    return [skipped(recommendation.signature, recommendation.reason)];
  });
  writeScopeImprovementState({
    projectDir: args.projectDir,
    inputs: args.inputs,
    actions: applied,
  });
  return summarizeActions(applied);
}

function summarizeActions(
  applied: ScopeImprovementAppliedAction[],
): ScopeImprovementActionResult {
  const createdTaskIds = applied
    .filter((action): action is Extract<ScopeImprovementAppliedAction, { kind: "created-task" }> =>
      action.kind === "created-task",
    )
    .map((action) => action.taskId);
  const ownerQuestionIds = applied
    .filter((action): action is Extract<ScopeImprovementAppliedAction, { kind: "owner-question" }> =>
      action.kind === "owner-question",
    )
    .map((action) => action.questionId);
  const safeEditPaths = applied
    .filter((action): action is Extract<ScopeImprovementAppliedAction, { kind: "safe-edit" }> =>
      action.kind === "safe-edit",
    )
    .map((action) => action.path);
  return {
    createdTaskIds,
    ownerQuestionIds,
    safeEditPaths,
    applied,
    requiresCommit:
      applied.some((action) =>
        action.kind === "created-task" ||
        action.kind === "updated-task" ||
        action.kind === "dropped-task"
      ) || safeEditPaths.length > 0,
  };
}

export function writeScopeImprovementArtifact(
  runDirPath: string,
  artifact: ScopeImprovementArtifact,
): string {
  mkdirSync(runDirPath, { recursive: true });
  const path = join(runDirPath, SCOPE_IMPROVEMENT_ARTIFACT);
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
  return path;
}
