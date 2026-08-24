import { readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import { renderUntrustedContent } from "#core/util/untrusted-content.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { withWorkflowBlockingOperation } from "#core/workflow/blocking-operation-context.js";
import type {
  WorkflowRepairContinuationController,
  WorkflowRepairContinuationDecision,
  WorkflowStepContext,
} from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import {
  type AgentJudgeConfig,
  invokeAgentJudge,
  isJudgeRunawayError,
  resolveAgentJudgeRunContract,
} from "#modules/autonomy/agent-judge.js";
import { inspectBuilderContinuationOperation } from "./continuation-inspection.js";
import {
  type BuilderContinuationArtifact,
  type BuilderContinuationJudgeDecision,
  parseBuilderContinuationJudgeDecision,
} from "./continuation-types.js";
import type { BuilderWorkspaceResult } from "./prepare-worktree-step.js";
import { reconcilePreservedBuilderWorkspace } from "./preserved-canonical-reconciliation-step.js";

const CONTINUATION_MAX_TURNS = 12;

const CONTINUATION_SYSTEM_PROMPT = `You are the single continuation authority for a long or expanding autonomous builder repair trajectory.

Judge whether another repair iteration remains the best use of the agent slot. Use only the supplied task contract, diff evidence, verification trajectory, remaining failures, success criteria, and live queue comparison. Never use elapsed time, token use, cost, turn count, or a fixed repair cap as a reason.

Decisions:
- continue: evidence shows concrete convergence and the current task is nearly complete enough that yielding would be wasteful.
- decompose: the remaining work is coherently separable and decomposition preserves the original product intent, dependencies, and acceptance evidence.
- preserve-yield: useful uncommitted work should be checkpointed and the slot released; favor this when progress is changing without convergence or higher-priority work is newly available, but priority alone cannot abort a healthy nearly-complete task.
- needs-owner: only a genuinely ambiguous product or safety choice requires owner judgment.

Return exactly one JSON object with keys decision, summary, nextAction, and evidence. evidence must be a non-empty array of concise citations to exact packet fields. Do not include markdown.`;

function continuationJudgeConfig(parentStep: WorkflowAgentStep): AgentJudgeConfig {
  return {
    label: "builder continuation authority",
    systemPrompt: CONTINUATION_SYSTEM_PROMPT,
    harness: parentStep.harness,
    model: parentStep.model,
    effort: parentStep.effort,
    maxTurns: CONTINUATION_MAX_TURNS,
    validateResponse: (text) => {
      parseBuilderContinuationJudgeDecision(text);
    },
  };
}

type RecordBuilderContinuationInput = {
  artifactPath: string;
  runId: string;
  decision: WorkflowRepairContinuationDecision;
};

export function recordBuilderContinuationInWorker(
  input: RecordBuilderContinuationInput,
): BuilderContinuationArtifact {
  const previous = readOptionalJsonFile<BuilderContinuationArtifact>(
    input.artifactPath,
  );
  if (
    previous !== null &&
    (previous.schemaVersion !== 1 ||
      previous.runId !== input.runId ||
      !Array.isArray(previous.decisions))
  ) {
    throw new Error("Existing builder continuation artifact is malformed");
  }
  const decisions = previous?.decisions.some(
    (candidate) => candidate.evidenceKey === input.decision.evidenceKey,
  )
    ? previous.decisions
    : [...(previous?.decisions ?? []), input.decision];
  const artifact: BuilderContinuationArtifact = {
    schemaVersion: 1,
    runId: input.runId,
    latestPacket: input.decision.packet,
    decisions,
  };
  writeJsonFileAtomic(input.artifactPath, artifact);
  return artifact;
}

const recordBuilderContinuationOperation = defineWorkflowBlockingOperation<
  RecordBuilderContinuationInput,
  BuilderContinuationArtifact
>(import.meta.url, "recordBuilderContinuationInWorker");

function judgePrompt(input: {
  packet: WorkflowRepairContinuationDecision["packet"];
  taskContract: string;
  diffContent: string;
}): string {
  const evidence = renderUntrustedContent({
    source: "builder.continuation.evidence",
    content: JSON.stringify(
      {
        packet: input.packet,
        taskContract: input.taskContract,
        diff: input.diffContent,
      },
      null,
      2,
    ),
  });
  return [
    "Review this new semantic continuation boundary.",
    "",
    ...evidence.lines,
    "",
    "Cite concrete packet fields. Choose one typed decision and its exact next action.",
  ].join("\n");
}

function decisionFromJudge(
  judged: BuilderContinuationJudgeDecision,
  packet: WorkflowRepairContinuationDecision["packet"],
): WorkflowRepairContinuationDecision {
  return {
    decision: judged.decision,
    evidenceKey: packet.boundaryKey,
    summary: `${judged.summary} Evidence: ${judged.evidence.join("; ")}`,
    nextAction: judged.nextAction,
    packet,
  };
}

function unavailableContinueDecision(
  error: Error,
  packet: WorkflowRepairContinuationDecision["packet"],
): WorkflowRepairContinuationDecision {
  return {
    decision: "continue",
    evidenceKey: packet.boundaryKey,
    summary: `Continuation judge was unavailable without a trustworthy verdict: ${error.message}`,
    nextAction:
      "Continue only until a materially different evidence boundary permits a fresh judgment.",
    packet,
  };
}

function claimedTaskId(
  stepOutputs: WorkflowStepContext["stepOutputs"],
): string | null {
  const claim = stepOutputs["claim-task"] as
    | { claimed?: boolean; taskId?: string }
    | undefined;
  return claim?.claimed === true && typeof claim.taskId === "string"
    ? claim.taskId
    : null;
}

function preparedWorkspace(
  stepOutputs: WorkflowStepContext["stepOutputs"],
): (BuilderWorkspaceResult & { taskId: string }) | null {
  const workspace = stepOutputs["prepare-worktree"] as
    | BuilderWorkspaceResult
    | undefined;
  return workspace?.enabled === true && typeof workspace.taskId === "string"
    ? (workspace as BuilderWorkspaceResult & { taskId: string })
    : null;
}

export const builderContinuationController: WorkflowRepairContinuationController = {
  resolveAgentContract: (parentStep) =>
    resolveAgentJudgeRunContract(continuationJudgeConfig(parentStep)),
  evaluate: async (continuation, ctx, parentStep) => {
    const taskId = claimedTaskId(ctx.stepOutputs);
    if (taskId === null) return null;
    const blocking = withWorkflowBlockingOperation(ctx);
    const workspaceDir = ctx.workspaceDir ?? ctx.projectDir;
    const inspection = await blocking.runBlocking(
      inspectBuilderContinuationOperation,
      {
        projectDir: ctx.projectDir,
        workspaceDir,
        runDir: ctx.workflow.runDirPath,
        agentRunDir:
          ctx.runtimeResources?.agentRunDir ?? ctx.workflow.runDirPath,
        runId: ctx.workflow.runId,
        taskId,
        priorRunIds:
          typeof ctx.trigger.payload.sourceRunId === "string"
            ? [ctx.trigger.payload.sourceRunId]
            : [],
        continuation,
      },
    );
    if (inspection.packet === null) return null;

    const config = continuationJudgeConfig(parentStep);
    let decision: WorkflowRepairContinuationDecision;
    try {
      const response = await invokeAgentJudge(
        judgePrompt({
          packet: inspection.packet,
          taskContract: inspection.taskContract,
          diffContent: inspection.diffContent,
        }),
        workspaceDir,
        config,
        ctx.runAgentHarness,
        ctx.signal,
      );
      decision = decisionFromJudge(
        parseBuilderContinuationJudgeDecision(response.text),
        inspection.packet,
      );
    } catch (error) {
      const judgeError = error instanceof Error ? error : new Error(String(error));
      if (!isJudgeRunawayError(judgeError)) throw judgeError;
      decision = unavailableContinueDecision(judgeError, inspection.packet);
    }
    if (decision.decision === "preserve-yield") {
      const workspace = preparedWorkspace(ctx.stepOutputs);
      if (workspace === null) {
        throw new Error(
          "Builder continuation cannot preserve-yield before an isolated task worktree is prepared",
        );
      }
      const checkpoint = await reconcilePreservedBuilderWorkspace(
        blocking,
        workspace,
        {
          artifactName: "builder-yield-checkpoint.json",
          validationCommands: [],
          needsReviewClaimDisposition: "retain-active",
        },
      );
      if (
        checkpoint.disposition !== "ready-to-resume" ||
        checkpoint.checkpointCommit === null ||
        checkpoint.integratedCanonicalHeadCommit === null
      ) {
        throw new Error(
          "Builder preserve-yield checkpoint failed: " +
            (checkpoint.reason ?? checkpoint.disposition),
        );
      }
      decision.packet.context.push({
        label: "checkpoint",
        value:
          `${checkpoint.disposition}; checkpoint ${checkpoint.checkpointCommit ?? "none"}; ` +
          `canonical ${checkpoint.integratedCanonicalHeadCommit ?? checkpoint.canonicalHeadCommit}`,
      });
    }
    await blocking.runBlocking(recordBuilderContinuationOperation, {
      artifactPath: inspection.artifactPath,
      runId: ctx.workflow.runId,
      decision,
    });
    return decision;
  },
};
