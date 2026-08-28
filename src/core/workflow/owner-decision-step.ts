import {
  getOwnerDecisionStore,
  type OwnerConfirmedActionMetadata,
  type OwnerDecisionRequest,
  type OwnerDecisionSelectedValue,
  type OwnerDecisionStore,
} from "#core/daemon/owner-decision-store.js";
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
  prompt: string;
  enqueuedAt: string;
};

export type AwaitedOwnerDecisionOutcome =
  | {
      kind: "answered";
      decisionId: string;
      selectedValue: OwnerDecisionSelectedValue;
    }
  | { kind: "canceled"; decisionId: string; reason: string }
  | { kind: "expired"; decisionId: string }
  | { kind: "timeout"; decisionId: string; awaitTimeoutMs: number };

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
  /** @deprecated Shadow queue no longer used by owner decision lifecycle */
  ownerQuestionQueue?: () => unknown;
};

export function ownerDecisionSteps(config: OwnerDecisionStepsConfig): OwnerDecisionSteps {
  const idPrefix = config.idPrefix ?? "owner-decision";
  const askId = `${idPrefix}-ask`;
  const waitId = `${idPrefix}-wait`;
  const consumeId = `${idPrefix}-consume`;
  const awaitTimeoutMs = config.awaitTimeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS;
  const resolveDecisionStore = config.decisionStore ?? (() => getOwnerDecisionStore());

  const ask = typedCodeStep<OwnerDecisionAskOutput>({
    id: askId,
    type: "code",
    validate: (raw) =>
      expectStructuredOutput<OwnerDecisionAskOutput>(raw, [
        "decisionId",
        "prompt",
        "enqueuedAt",
      ]),
    run: (ctx): OwnerDecisionAskOutput => {
      const input = typeof config.input === "function" ? config.input(ctx) : config.input;
      const decisionStore = resolveDecisionStore();
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
        expiresAt: new Date(
          Date.now() + (input.decisionTimeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS),
        ).toISOString(),
        ...(input.action !== undefined && { action: input.action }),
      });
      return {
        decisionId: decision.id,
        prompt: input.request.prompt,
        enqueuedAt: decision.createdAt,
      };
    },
  });

  const wait: WorkflowAwaitEventStep = {
    id: waitId,
    type: "await-event",
    event: "owner.decision.resolved",
    matchField: "id",
    matchValue: (ctx) => ask.outputRequired(ctx).decisionId,
    awaitTimeoutMs,
  };

  const consume = typedCodeStep<AwaitedOwnerDecisionOutcome>({
    id: consumeId,
    type: "code",
    validate: (raw) =>
      expectStructuredOutput<AwaitedOwnerDecisionOutcome>(raw, ["kind", "decisionId"]),
    run: (ctx): AwaitedOwnerDecisionOutcome => {
      const askOutput = ask.outputRequired(ctx);
      const waitOutput = ctx.stepOutputs[waitId] as AwaitEventStepOutput;
      if (waitOutput.kind === "timeout") {
        return {
          kind: "timeout",
          decisionId: askOutput.decisionId,
          awaitTimeoutMs: waitOutput.awaitTimeoutMs,
        };
      }
      const decisionStore = resolveDecisionStore();
      const decision = decisionStore.get(askOutput.decisionId);
      if (!decision) {
        throw new Error(`owner decision ${askOutput.decisionId} disappeared before consume`);
      }
      if (decision.status === "answered" || decision.status === "consumed") {
        if (!decision.selectedValue) {
          throw new Error(
            `owner decision ${decision.id} is ${decision.status} without a selected value`,
          );
        }
        return {
          kind: "answered",
          decisionId: decision.id,
          selectedValue: decision.selectedValue,
        };
      }
      if (decision.status === "canceled") {
        return {
          kind: "canceled",
          decisionId: decision.id,
          reason: decision.canceledReason ?? "",
        };
      }
      if (decision.status === "expired") {
        return {
          kind: "expired",
          decisionId: decision.id,
        };
      }
      throw new Error(
        `owner decision ${decision.id} resolved on the bus but still reports pending`,
      );
    },
  });

  return { ask, wait, consume };
}
