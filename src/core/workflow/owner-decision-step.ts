import {
  getOwnerDecisionStore,
  type OwnerConfirmedActionMetadata,
  type OwnerDecisionJsonObject,
  type OwnerDecisionRecord,
  type OwnerDecisionRequest,
  type OwnerDecisionSelectedValue,
  type OwnerDecisionStore,
} from "#core/daemon/owner-decision-store.js";
import { getOwnerQuestionQueue, type OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { reviewOwnerQuestion } from "#core/daemon/owner-question-review.js";
import type { WorkflowStepContext } from "./run-types.js";
import type { TypedCodeStepInput } from "./step-input-code.js";
import { expectStructuredOutput, typedCodeStep } from "./step-input-code.js";
import type { WorkflowAwaitEventStep } from "./step-types.js";
import type { AwaitEventStepOutput } from "./steps/step-executor-await-event.js";

const DEFAULT_DECISION_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_AWAIT_TIMEOUT_MS = 10 * 60 * 1000;

export type OwnerDecisionStepInput = {
  context: string;
  reason: string;
  request: OwnerDecisionRequest;
  evidence?: { summary: string; source?: string; artifactPath?: string }[];
  taskId?: string;
  source?: string;
  decisionTimeoutMs?: number;
  action?: OwnerConfirmedActionMetadata;
};

export type OwnerDecisionAskOutput = {
  decisionId: string;
  ownerQuestionId: string;
  prompt: string;
  enqueuedAt: string;
};

export type AwaitedOwnerDecisionOutcome =
  | {
      kind: "answered";
      decisionId: string;
      ownerQuestionId: string;
      selectedValue: OwnerDecisionSelectedValue;
    }
  | { kind: "canceled"; decisionId: string; ownerQuestionId: string; reason: string }
  | { kind: "expired"; decisionId: string; ownerQuestionId: string }
  | { kind: "timeout"; decisionId: string; ownerQuestionId: string; awaitTimeoutMs: number };

export type OwnerDecisionSteps = {
  ask: TypedCodeStepInput<OwnerDecisionAskOutput>;
  wait: WorkflowAwaitEventStep;
  consume: TypedCodeStepInput<AwaitedOwnerDecisionOutcome>;
};

export type OwnerDecisionStepsConfig = {
  idPrefix?: string;
  input:
    | OwnerDecisionStepInput
    | ((context: WorkflowStepContext) => OwnerDecisionStepInput);
  awaitTimeoutMs?: number;
  decisionStore?: () => OwnerDecisionStore;
  ownerQuestionQueue?: () => OwnerQuestionQueue;
};

function proposedAnswers(request: OwnerDecisionRequest): string[] {
  if (request.kind === "single-choice" || request.kind === "multi-choice") {
    return request.options.map((option) => `${option.id}: ${option.label}`);
  }
  return [];
}

function optionIdFromAnswer(request: Extract<OwnerDecisionRequest, { options: { id: string; label: string }[] }>, answer: string): string {
  const trimmed = answer.trim();
  const direct = request.options.find((option) => option.id === trimmed || option.label === trimmed);
  if (direct) return direct.id;
  const beforeColon = /^([^:]+):/.exec(trimmed)?.[1]?.trim();
  if (beforeColon && request.options.some((option) => option.id === beforeColon)) return beforeColon;
  throw new Error(`owner decision answer "${answer}" does not match a proposed option`);
}

function parseOwnerDecisionAnswer(
  request: OwnerDecisionRequest,
  answer: string,
): OwnerDecisionSelectedValue {
  if (request.kind === "single-choice") {
    return { kind: "single-choice", optionId: optionIdFromAnswer(request, answer) };
  }
  if (request.kind === "multi-choice") {
    const optionIds = answer
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => optionIdFromAnswer(request, part));
    return { kind: "multi-choice", optionIds };
  }
  if (request.kind === "free-text") return { kind: "free-text", text: answer.trim() };
  const parsed = JSON.parse(answer) as OwnerDecisionJsonObject;
  return { kind: "form", fields: parsed };
}

function outcomeFromDecision(
  decision: OwnerDecisionRecord,
  ownerQuestionId: string,
): AwaitedOwnerDecisionOutcome {
  if (decision.status === "answered" || decision.status === "consumed") {
    if (!decision.selectedValue) {
      throw new Error(`owner decision ${decision.id} is ${decision.status} without a selected value`);
    }
    return {
      kind: "answered",
      decisionId: decision.id,
      ownerQuestionId,
      selectedValue: decision.selectedValue,
    };
  }
  if (decision.status === "canceled") {
    return {
      kind: "canceled",
      decisionId: decision.id,
      ownerQuestionId,
      reason: decision.canceledReason ?? "",
    };
  }
  if (decision.status === "expired") {
    return { kind: "expired", decisionId: decision.id, ownerQuestionId };
  }
  throw new Error(`owner decision ${decision.id} is still pending`);
}

export function ownerDecisionSteps(config: OwnerDecisionStepsConfig): OwnerDecisionSteps {
  const idPrefix = config.idPrefix ?? "owner-decision";
  const askId = `${idPrefix}-ask`;
  const waitId = `${idPrefix}-wait`;
  const consumeId = `${idPrefix}-consume`;
  const awaitTimeoutMs = config.awaitTimeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS;
  const resolveDecisionStore = config.decisionStore ?? (() => getOwnerDecisionStore());
  const resolveOwnerQuestionQueue = config.ownerQuestionQueue ?? (() => getOwnerQuestionQueue());

  const ask = typedCodeStep<OwnerDecisionAskOutput>({
    id: askId,
    type: "code",
    validate: (raw) => expectStructuredOutput<OwnerDecisionAskOutput>(raw, [
      "decisionId",
      "ownerQuestionId",
      "prompt",
      "enqueuedAt",
    ]),
    run: (ctx): OwnerDecisionAskOutput => {
      const input = typeof config.input === "function" ? config.input(ctx) : config.input;
      const decisionStore = resolveDecisionStore();
      const ownerQuestionQueue = resolveOwnerQuestionQueue();
      const recent = ownerQuestionQueue.list().slice(-100);
      const review = reviewOwnerQuestion(
        {
          context: input.context,
          question: input.request.prompt,
          reason: input.reason,
          proposedAnswers: proposedAnswers(input.request),
        },
        recent,
      );
      if (!review.ok) throw new Error(`ownerDecisionSteps: question rejected by review gate: ${review.reason}`);
      const decision = decisionStore.create({
        request: input.request,
        requester: {
          kind: "workflow",
          workflowName: ctx.workflow.name,
          runId: ctx.workflow.runId,
          stepId: askId,
          taskId: input.taskId ?? null,
        },
        evidence: input.evidence ?? [{ summary: input.context }],
        expiresAt: new Date(Date.now() + (input.decisionTimeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS)).toISOString(),
        ...(input.action !== undefined && { action: input.action }),
      });
      const question = ownerQuestionQueue.enqueue({
        context: `${input.context}\n\nDecision id: ${decision.id}`,
        question: input.request.prompt,
        reason: input.reason,
        source: input.source ?? "owner-decision",
        answerBehavior: "workflow-resume",
        origin: {
          kind: "workflow",
          workflowName: ctx.workflow.name,
          runId: ctx.workflow.runId,
          stepId: askId,
          taskId: input.taskId ?? null,
        },
        proposedAnswers: proposedAnswers(input.request),
        timeoutMs: input.decisionTimeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS,
        defaultResolution: "dismiss",
      });
      decisionStore.linkOwnerQuestion(decision.id, question.id);
      return {
        decisionId: decision.id,
        ownerQuestionId: question.id,
        prompt: input.request.prompt,
        enqueuedAt: decision.createdAt,
      };
    },
  });

  const wait: WorkflowAwaitEventStep = {
    id: waitId,
    type: "await-event",
    event: "owner.question.resolved",
    matchField: "id",
    matchValue: (ctx) => ask.outputRequired(ctx).ownerQuestionId,
    awaitTimeoutMs,
  };

  const consume = typedCodeStep<AwaitedOwnerDecisionOutcome>({
    id: consumeId,
    type: "code",
    validate: (raw) => expectStructuredOutput<AwaitedOwnerDecisionOutcome>(raw, ["kind", "decisionId", "ownerQuestionId"]),
    run: (ctx): AwaitedOwnerDecisionOutcome => {
      const askOutput = ask.outputRequired(ctx);
      const waitOutput = ctx.stepOutputs[waitId] as AwaitEventStepOutput;
      if (waitOutput.kind === "timeout") {
        return {
          kind: "timeout",
          decisionId: askOutput.decisionId,
          ownerQuestionId: askOutput.ownerQuestionId,
          awaitTimeoutMs: waitOutput.awaitTimeoutMs,
        };
      }
      const decisionStore = resolveDecisionStore();
      const existing = decisionStore.get(askOutput.decisionId);
      if (!existing) throw new Error(`owner decision ${askOutput.decisionId} disappeared before consume`);
      if (existing.status !== "pending") return outcomeFromDecision(existing, askOutput.ownerQuestionId);
      const question = resolveOwnerQuestionQueue().get(askOutput.ownerQuestionId);
      if (!question) throw new Error(`owner question ${askOutput.ownerQuestionId} disappeared before decision consume`);
      if (question.status === "answered") {
        const selected = parseOwnerDecisionAnswer(existing.request, question.answer ?? "");
        const answered = decisionStore.answer(existing.id, selected, question.resolutionSource ?? "owner-question");
        if (!answered) throw new Error(`owner decision ${existing.id} could not be answered from owner question`);
        return outcomeFromDecision(answered, askOutput.ownerQuestionId);
      }
      if (question.status === "dismissed") {
        const canceled = decisionStore.cancel(existing.id, question.dismissalReason ?? "", question.resolutionSource ?? "owner-question");
        if (!canceled) throw new Error(`owner decision ${existing.id} could not be canceled from owner question`);
        return outcomeFromDecision(canceled, askOutput.ownerQuestionId);
      }
      if (question.status === "expired") {
        const expired = decisionStore.expire(existing.id, question.resolutionSource ?? "owner-question");
        if (!expired) throw new Error(`owner decision ${existing.id} could not be expired from owner question`);
        return outcomeFromDecision(expired, askOutput.ownerQuestionId);
      }
      throw new Error(`owner question ${question.id} resolved on the bus but still reports pending`);
    },
  });

  return { ask, wait, consume };
}
