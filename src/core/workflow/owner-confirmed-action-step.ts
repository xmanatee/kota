import { type ApprovalQueue, getApprovalQueue } from "#core/daemon/approval-queue.js";
import {
  createConfirmedActionDeadLetter,
  type DeadLetterQueueStore,
  toEventJsonObject,
} from "#core/daemon/dead-letter-queue.js";
import { getIdempotencyStore } from "#core/daemon/idempotency-singleton.js";
import {
  fingerprintIdempotencyParams,
  hashIdempotencyMaterial,
  type IdempotencyJsonObject,
  type IdempotencyStore,
  toIdempotencyJsonValue,
} from "#core/daemon/idempotency-store.js";
import {
  getOwnerDecisionStore,
  type OwnerConfirmedActionMetadata,
  type OwnerDecisionJsonObject,
  type OwnerDecisionJsonValue,
  type OwnerDecisionRecord,
  type OwnerDecisionSelectedValue,
  type OwnerDecisionStore,
} from "#core/daemon/owner-decision-store.js";
import type { WorkflowStepContext, WorkflowValueResolver } from "./run-types.js";
import type { TypedCodeStepInput } from "./step-input-code.js";
import { expectStructuredOutput, typedCodeStep } from "./step-input-code.js";
import { resolveValue } from "./steps/step-executor.js";

export type OwnerConfirmedActionAdapter<TInput extends OwnerDecisionJsonObject, TResult> = {
  metadata: OwnerConfirmedActionMetadata;
  execute: (args: {
    decision: OwnerDecisionRecord;
    selectedValue: OwnerDecisionSelectedValue;
    input: TInput;
    context: WorkflowStepContext;
  }) => Promise<TResult> | TResult;
};

export type OwnerConfirmedActionStepOutput<TResult> = {
  decisionId: string;
  actionId: string;
  adapterName: string;
  dryRun: boolean;
  dangerousEffect: boolean;
  approvalId: string | null;
  executedAt: string;
  idempotency: { status: "accepted" | "replayed"; key: string };
  result: TResult;
};

export type ConfirmedOwnerActionStepConfig<TInput extends OwnerDecisionJsonObject, TResult> = {
  id: string;
  decisionId: WorkflowValueResolver<string>;
  input: WorkflowValueResolver<TInput>;
  approvalId?: WorkflowValueResolver<string | null>;
  adapter: OwnerConfirmedActionAdapter<TInput, TResult>;
  decisionStore?: () => OwnerDecisionStore;
  approvalQueue?: () => ApprovalQueue;
  idempotencyStore?: () => IdempotencyStore;
  deadLetterQueue?: () => DeadLetterQueueStore;
};

async function resolveOptionalValue<T>(context: WorkflowStepContext, resolver: WorkflowValueResolver<T | null> | undefined): Promise<T | null> {
  if (resolver === undefined) return null;
  return resolveValue(resolver, context);
}

function jsonObjectKeys(value: OwnerDecisionJsonObject): string[] {
  return Object.keys(value).filter((key) => value[key] !== undefined).sort();
}

function jsonObjectsEqual(left: OwnerDecisionJsonObject, right: OwnerDecisionJsonObject): boolean {
  const leftKeys = jsonObjectKeys(left);
  const rightKeys = jsonObjectKeys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const [index, key] of leftKeys.entries()) {
    if (key !== rightKeys[index]) return false;
    const leftValue = left[key];
    const rightValue = right[key];
    if (leftValue === undefined || rightValue === undefined) return false;
    if (!jsonValuesEqual(leftValue, rightValue)) return false;
  }
  return true;
}

function jsonValuesEqual(left: OwnerDecisionJsonValue, right: OwnerDecisionJsonValue): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    for (const [index, item] of left.entries()) {
      const rightItem = right[index];
      if (rightItem === undefined) return false;
      if (!jsonValuesEqual(item, rightItem)) return false;
    }
    return true;
  }
  if (typeof left === "object" || typeof right === "object") {
    if (typeof left !== "object" || typeof right !== "object") return false;
    return jsonObjectsEqual(left, right);
  }
  return false;
}

function optionSetsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function selectedValuesEqual(
  selected: OwnerDecisionSelectedValue,
  authorizingSelection: OwnerDecisionSelectedValue,
): boolean {
  if (selected.kind === "single-choice" && authorizingSelection.kind === "single-choice") {
    return selected.optionId === authorizingSelection.optionId;
  }
  if (selected.kind === "multi-choice" && authorizingSelection.kind === "multi-choice") {
    return optionSetsEqual(selected.optionIds, authorizingSelection.optionIds);
  }
  if (selected.kind === "free-text" && authorizingSelection.kind === "free-text") {
    return selected.text === authorizingSelection.text;
  }
  if (selected.kind === "form" && authorizingSelection.kind === "form") {
    return jsonObjectsEqual(selected.fields, authorizingSelection.fields);
  }
  return false;
}

function assertDecisionAuthorizesAction(
  decision: OwnerDecisionRecord,
  metadata: OwnerConfirmedActionMetadata,
): { action: OwnerConfirmedActionMetadata; selectedValue: OwnerDecisionSelectedValue } {
  if ((decision.status !== "answered" && decision.status !== "consumed") || !decision.selectedValue) {
    throw new Error(`confirmedOwnerActionStep: decision ${decision.id} is not answered`);
  }
  const action = decision.action;
  if (!action || action.actionId !== metadata.actionId) {
    throw new Error(`confirmedOwnerActionStep: decision ${decision.id} does not authorize action ${metadata.actionId}`);
  }
  if (action.adapterName !== metadata.adapterName) {
    throw new Error(`confirmedOwnerActionStep: decision ${decision.id} authorizes a different adapter`);
  }
  if (action.dryRun !== metadata.dryRun) {
    throw new Error(`confirmedOwnerActionStep: decision ${decision.id} authorizes a different dry-run mode`);
  }
  if (action.dangerousEffect !== metadata.dangerousEffect) {
    throw new Error(`confirmedOwnerActionStep: decision ${decision.id} authorizes a different dangerous-effect posture`);
  }
  if (!metadata.requiresConfirmation || !action.requiresConfirmation) {
    throw new Error("confirmedOwnerActionStep requires adapter metadata requiresConfirmation=true");
  }
  if (!selectedValuesEqual(action.authorizingSelection, metadata.authorizingSelection)) {
    throw new Error(`confirmedOwnerActionStep: decision ${decision.id} authorizes a different selected value`);
  }
  if (!selectedValuesEqual(decision.selectedValue, action.authorizingSelection)) {
    throw new Error(
      `confirmedOwnerActionStep: decision ${decision.id} selected value does not authorize action ${metadata.actionId}`,
    );
  }
  return { action, selectedValue: decision.selectedValue };
}

function assertDangerousApproval(
  metadata: OwnerConfirmedActionMetadata,
  approvalId: string | null,
  queue: ApprovalQueue,
): void {
  if (!metadata.dangerousEffect) return;
  if (!approvalId) throw new Error("dangerous confirmed action requires an approval id");
  const approval = queue.get(approvalId);
  if (!approval || approval.status !== "approved") {
    throw new Error(`dangerous confirmed action approval ${approvalId} is not approved`);
  }
}

function explicitRedriveId(context: WorkflowStepContext): string | null {
  const redriveOf = context.trigger.payload.redriveOf;
  return typeof redriveOf === "string" && redriveOf.trim().length > 0
    ? redriveOf
    : null;
}

function confirmedActionIdempotencyKey(
  decision: OwnerDecisionRecord,
  decisionId: string,
  action: OwnerConfirmedActionMetadata,
  redriveOf: string | null,
): string {
  const baseKey = `owner-action:${hashIdempotencyMaterial([
    decision.scopeId,
    decisionId,
    action.adapterName,
    action.actionId,
  ])}`;
  if (redriveOf === null) return baseKey;
  return `owner-action-redrive:${hashIdempotencyMaterial([baseKey, redriveOf])}`;
}

function decisionForExecution(
  store: OwnerDecisionStore,
  decision: OwnerDecisionRecord,
  action: OwnerConfirmedActionMetadata,
  decisionId: string,
  workflowName: string,
  runId: string,
  stepId: string,
  approvalId: string | null,
): OwnerDecisionRecord {
  if (decision.status === "consumed") {
    const consumption = decision.consumption;
    if (
      consumption === undefined ||
      consumption.actionId !== action.actionId ||
      consumption.adapterName !== action.adapterName ||
      consumption.approvalId !== approvalId
    ) {
      throw new Error(`confirmedOwnerActionStep: decision ${decisionId} consumption does not match action ${action.actionId}`);
    }
    return decision;
  }

  const consumed = store.consumeForAction(decisionId, {
    workflowName,
    runId,
    stepId,
    actionId: action.actionId,
    adapterName: action.adapterName,
    approvalId,
  });
  if (!consumed.ok) throw new Error(`confirmedOwnerActionStep: decision ${decisionId} consumption failed: ${consumed.reason}`);
  return consumed.decision;
}

function idempotencyResultOutput<TResult>(projection: IdempotencyJsonObject): OwnerConfirmedActionStepOutput<TResult> {
  const output = projection.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    throw new Error("confirmedOwnerActionStep: stored idempotency result is malformed");
  }
  return output as OwnerConfirmedActionStepOutput<TResult>;
}

function idempotencyError(projection: IdempotencyJsonObject): Error | null {
  const message = projection.error;
  return typeof message === "string" ? new Error(message) : null;
}

export function confirmedOwnerActionStep<TInput extends OwnerDecisionJsonObject, TResult>(
  config: ConfirmedOwnerActionStepConfig<TInput, TResult>,
): TypedCodeStepInput<OwnerConfirmedActionStepOutput<TResult>> {
  return typedCodeStep<OwnerConfirmedActionStepOutput<TResult>>({
    id: config.id,
    type: "code",
    validate: (raw) => expectStructuredOutput<OwnerConfirmedActionStepOutput<TResult>>(raw, [
      "decisionId",
      "actionId",
      "adapterName",
      "dryRun",
      "dangerousEffect",
      "approvalId",
      "executedAt",
      "idempotency",
      "result",
    ]),
    run: async (ctx): Promise<OwnerConfirmedActionStepOutput<TResult>> => {
      const decisionId = await resolveValue(config.decisionId, ctx);
      const input = await resolveValue(config.input, ctx);
      const approvalId = await resolveOptionalValue(ctx, config.approvalId);
      const store = config.decisionStore ? config.decisionStore() : getOwnerDecisionStore();
      const decision = store.get(decisionId);
      if (!decision) throw new Error(`confirmedOwnerActionStep: decision ${decisionId} not found`);
      const authorization = assertDecisionAuthorizesAction(decision, config.adapter.metadata);
      assertDangerousApproval(
        authorization.action,
        approvalId,
        config.approvalQueue ? config.approvalQueue() : getApprovalQueue(),
      );
      const idempotencyStore = config.idempotencyStore
        ? config.idempotencyStore()
        : getIdempotencyStore();
      const idempotencyKey = confirmedActionIdempotencyKey(
        decision,
        decisionId,
        authorization.action,
        explicitRedriveId(ctx),
      );
      const claim = idempotencyStore.claim({
        scopeId: decision.scopeId,
        operation: "owner-confirmed-action",
        key: idempotencyKey,
        parameterFingerprint: fingerprintIdempotencyParams({
          action: authorization.action,
          approvalId,
          input: input as IdempotencyJsonObject,
        }),
      });
      if (claim.status === "replayed") {
        const error = idempotencyError(claim.result);
        if (error) throw error;
        return {
          ...idempotencyResultOutput<TResult>(claim.result),
          idempotency: { status: "replayed", key: idempotencyKey },
        };
      }
      if (claim.status === "ignored") {
        throw new Error(`confirmedOwnerActionStep: duplicate action ${idempotencyKey} is already in progress`);
      }
      if (claim.status === "expired") {
        throw new Error(`confirmedOwnerActionStep: duplicate action ${idempotencyKey} expired before retry`);
      }
      if (claim.status === "rejected") {
        throw new Error(
          `confirmedOwnerActionStep: duplicate action ${idempotencyKey} reused different parameters`,
        );
      }
      try {
        const executionDecision = decisionForExecution(
          store,
          decision,
          authorization.action,
          decisionId,
          ctx.workflow.name,
          ctx.workflow.runId,
          config.id,
          approvalId,
        );
        const result = await config.adapter.execute({
          decision: executionDecision,
          selectedValue: authorization.selectedValue,
          input,
          context: ctx,
        });
        const output: OwnerConfirmedActionStepOutput<TResult> = {
          decisionId,
          actionId: authorization.action.actionId,
          adapterName: authorization.action.adapterName,
          dryRun: authorization.action.dryRun,
          dangerousEffect: authorization.action.dangerousEffect,
          approvalId,
          executedAt: executionDecision.consumption?.consumedAt ?? new Date().toISOString(),
          idempotency: { status: "accepted", key: idempotencyKey },
          result,
        };
        idempotencyStore.complete(claim.reservation, {
          kind: "owner-confirmed-action",
          output: toIdempotencyJsonValue(output as IdempotencyJsonObject),
        });
        return output;
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        idempotencyStore.complete(claim.reservation, {
          kind: "owner-confirmed-action",
          error: failure.message,
        });
        const deadLetterQueue = config.deadLetterQueue
          ? config.deadLetterQueue()
          : ctx.deadLetterQueue;
        if (deadLetterQueue !== undefined) {
          createConfirmedActionDeadLetter({
            store: deadLetterQueue,
            scopeId: decision.scopeId,
            decisionId,
            actionId: authorization.action.actionId,
            adapterName: authorization.action.adapterName,
            workflowName: ctx.workflow.name,
            runId: ctx.workflow.runId,
            stepId: config.id,
            reason: failure.message,
            redactedInput: toEventJsonObject(input),
          });
        }
        throw failure;
      }
    },
  });
}
