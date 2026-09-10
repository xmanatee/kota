import { renderUntrustedContent } from "#core/util/untrusted-content.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { withWorkflowBlockingOperation } from "#core/workflow/blocking-operation-context.js";
import type {
  WorkflowContinuationContext,
  WorkflowContinuationDecision,
  WorkflowContinuationPacket,
} from "#core/workflow/continuation.js";
import type {
  WorkflowRepairLoopConfig,
  WorkflowStepContext,
} from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import {
  invokeStructuredAgentJudge,
  resolveAgentJudgeRunContract,
} from "#modules/autonomy/agent-judge.js";
import { listBuilderTaskDispatches } from "#modules/autonomy/workflows/builder/task-contract.js";
import {
  getRepoTaskQueueSnapshot,
  type RepoTaskPriority,
} from "#modules/repo-tasks/repo-tasks-domain.js";

const PRIORITY = Object.freeze({ p0: 0, p1: 1, p2: 2, p3: 3 });

export type AutonomyContinuationSubject = Readonly<{
  id: string;
  priority: RepoTaskPriority;
  taskContract: string;
}>;

type AutonomyContinuationContextInput = AutonomyContinuationSubject &
  Readonly<{ scopeRoot: string }>;

function priorityValue(priority: RepoTaskPriority): number {
  return PRIORITY[priority];
}

export function collectAutonomyContinuationContext(
  input: AutonomyContinuationContextInput,
): WorkflowContinuationContext {
  const queue = listBuilderTaskDispatches(input.scopeRoot);
  const queueSnapshot = getRepoTaskQueueSnapshot(input.scopeRoot);
  return Object.freeze({
    taskContract: input.taskContract,
    current: Object.freeze({
      id: input.id,
      priority: priorityValue(input.priority),
      priorityLabel: input.priority,
    }),
    queue: Object.freeze({
      revision: queueSnapshot.headSha,
      available: Object.freeze(queue.map((task) =>
        Object.freeze({
          id: task.taskId,
          title: task.title,
          priority: priorityValue(task.priority),
          priorityLabel: task.priority,
          resource: `task:${task.taskId}`,
        })
      )),
    }),
  });
}

const collectAutonomyContinuationContextOperation =
  defineWorkflowBlockingOperation<
    AutonomyContinuationContextInput,
    WorkflowContinuationContext
  >(import.meta.url, "collectAutonomyContinuationContext");

function continuationSystemPrompt(decompositionSupported: boolean): string {
  const decompositionRail = decompositionSupported
    ? "Decompose is available through this run's domain failure consumer."
    : "This run has no domain decomposition consumer. Do not select decompose; preserve and yield when the work should be split or deferred.";
  return `You are the continuation authority for a difficult autonomous run. Decide whether another iteration is the best use of the shared agent slot.

Use the task contract, current diff, verification trajectory, remaining failures, and queue priorities together. Priority alone does not justify interrupting a healthy nearly-complete run. Prefer continue when evidence is converging. Prefer decompose only when the original intent can be preserved as deduplicated outcome-sized tasks. Prefer preserve-yield when unpublished work should remain intact while proven higher-priority work runs. Use needs-owner only for a genuinely ambiguous decision that cannot safely be resolved from repository evidence.

${decompositionRail}

Return exactly one JSON object with no surrounding prose or markdown:
{
  "decision": "continue" | "decompose" | "preserve-yield" | "needs-owner",
  "rationale": "specific progress, remaining-risk, and priority evidence",
  "nextAction": "one exact action for this same run lineage"
}`;
}

function parseContinuationDecision(
  text: string,
  decompositionSupported: boolean,
): WorkflowContinuationDecision {
  const raw = JSON.parse(text) as unknown;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Continuation decision must be a JSON object");
  }
  const value = raw as Record<string, unknown>;
  const decision = value.decision;
  if (
    decision !== "continue" &&
    decision !== "decompose" &&
    decision !== "preserve-yield" &&
    decision !== "needs-owner"
  ) {
    throw new Error("Continuation decision has an invalid decision value");
  }
  if (decision === "decompose" && !decompositionSupported) {
    throw new Error(
      "This continuation owner has no domain decomposition consumer; use preserve-yield",
    );
  }
  if (typeof value.rationale !== "string" || !value.rationale.trim()) {
    throw new Error("Continuation decision requires a rationale");
  }
  if (typeof value.nextAction !== "string" || !value.nextAction.trim()) {
    throw new Error("Continuation decision requires a nextAction");
  }
  return {
    decision,
    rationale: value.rationale,
    nextAction: value.nextAction,
  };
}

function continuationJudgeConfig(
  parentStep: WorkflowAgentStep,
  decompositionSupported: boolean,
) {
  return {
    label: "Continuation judge",
    systemPrompt: continuationSystemPrompt(decompositionSupported),
    harness: parentStep.harness,
    model: parentStep.model,
    effort: parentStep.effort,
  } as const;
}

export function autonomyContinuationPolicy(input: Readonly<{
  resolveSubject: (
    context: WorkflowStepContext,
  ) => AutonomyContinuationSubject;
  decompositionSupported: boolean;
}>): NonNullable<WorkflowRepairLoopConfig["continuation"]> {
  return {
    resolveAgentContract: (parentStep) =>
      resolveAgentJudgeRunContract(
        continuationJudgeConfig(parentStep, input.decompositionSupported),
      ),
    collectContext: (ctx) => {
      const subject = input.resolveSubject(ctx);
      return withWorkflowBlockingOperation(ctx).runBlocking(
        collectAutonomyContinuationContextOperation,
        { scopeRoot: ctx.scopeRoot, ...subject },
      );
    },
    decide: async (ctx, parentStep, packet: WorkflowContinuationPacket) => {
      const rendered = renderUntrustedContent({
        source: "workflow.continuation.packet",
        content: JSON.stringify(packet, null, 2),
      });
      const parse = (text: string) =>
        parseContinuationDecision(text, input.decompositionSupported);
      const response = await invokeStructuredAgentJudge(
        [
          "Continuation evidence packet:",
          ...rendered.lines,
          "",
          "Return the typed continuation decision now.",
        ].join("\n"),
        ctx.workspaceRoot,
        continuationJudgeConfig(parentStep, input.decompositionSupported),
        ctx.runAgentHarness,
        parse,
        ctx.signal,
      );
      return parse(response.text);
    },
  };
}

export function workflowRunContinuationSubject(
  context: WorkflowStepContext,
  input: Readonly<{
    purpose: string;
    evidence?: readonly Readonly<{ label: string; value: string }>[];
    priority?: RepoTaskPriority;
  }>,
): AutonomyContinuationSubject {
  return Object.freeze({
    id: `workflow:${context.workflow.name}:${context.workflow.runId}`,
    priority: input.priority ?? "p3",
    taskContract: [
      `Workflow: ${context.workflow.name}`,
      `Run: ${context.workflow.runId}`,
      `Purpose: ${input.purpose}`,
      `Trigger: ${JSON.stringify(context.trigger)}`,
      ...(input.evidence ?? []).map(
        (evidence) => `${evidence.label}: ${evidence.value}`,
      ),
    ].join("\n"),
  });
}
