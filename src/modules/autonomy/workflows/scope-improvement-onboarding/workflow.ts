import { resolve } from "node:path";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { scopeImprovementRequested } from "../scope-improver/events.js";
import {
  decodeScopeImprovementState,
  SCOPE_IMPROVEMENT_STATE_KEY,
} from "../scope-improver/scope-improvement-state.js";
import type { ScopeImprovementState } from "../scope-improver/scope-improvement-types.js";
import { prepareInitialScopeImprovement } from "./initial-request.js";

const workflow: WorkflowDefinitionInput = {
  name: "scope-improvement-onboarding",
  repository: "none",
  description:
    "Reserve and publish the initial scope-improvement request after onboarding commits.",
  triggers: [
    {
      event: "scope.lifecycle.changed",
      cooldownMs: 0,
      queueMode: "all",
    },
  ],
  triggerAdmission: ({ scopeRoot, trigger, state: scopeState }) => {
    const payload = trigger.payload;
    if (payload.transition !== "onboarding-completed") {
      return { admitted: false, reason: "scope lifecycle transition is not completed onboarding" };
    }
    if (
      typeof payload.idempotencyKey !== "string" ||
      payload.idempotencyKey.trim().length === 0
    ) {
      return { admitted: false, reason: "scope onboarding completion has no durable identity" };
    }
    if (trigger.eventId !== payload.idempotencyKey) {
      return { admitted: false, reason: "scope onboarding completion identity is inconsistent" };
    }
    const scopeId = deriveDirectoryScopeId(scopeRoot);
    if (
      payload.affectedScopeId !== scopeId ||
      typeof payload.directoryRoot !== "string" ||
      resolve(payload.directoryRoot) !== resolve(scopeRoot)
    ) {
      return {
        admitted: false,
        reason: "scope lifecycle event belongs to another runtime scope",
      };
    }
    const state = decodeScopeImprovementState(
      scopeState.read<ScopeImprovementState>(SCOPE_IMPROVEMENT_STATE_KEY).value,
      scopeId,
    );
    if (
      state.consumedFingerprint !== null ||
      state.pendingFingerprint !== null
    ) {
      return {
        admitted: false,
        reason: "scope onboarding has already been reserved or consumed",
      };
    }
    return { admitted: true };
  },
  steps: [
    {
      id: "reserve-initial-scope-improvement",
      type: "code",
      run: (ctx) => {
        if (!ctx.scopePolicySnapshot) {
          throw new Error(
            "scope onboarding requires an authoritative resolved scope-policy snapshot",
          );
        }
        const scopeId = deriveDirectoryScopeId(ctx.scopeRoot);
        const snapshot = ctx.state.read<ScopeImprovementState>(
          SCOPE_IMPROVEMENT_STATE_KEY,
        );
        const currentState = decodeScopeImprovementState(snapshot.value, scopeId);
        if (
          currentState.consumedFingerprint !== null ||
          currentState.pendingFingerprint !== null
        ) {
          return { disposition: "already-reserved" };
        }
        const initial = prepareInitialScopeImprovement({
          scopeRoot: ctx.scopeRoot, stateDir: ctx.stateDir,
          scopePolicySnapshot: ctx.scopePolicySnapshot, state: currentState,
        });
        if (!initial.shouldEmit || !initial.payload || !initial.nextState) return { disposition: "deferred", reason: initial.reason };
        ctx.state.compareAndSet(SCOPE_IMPROVEMENT_STATE_KEY, snapshot.revision, initial.nextState);
        ctx.emit(
          scopeImprovementRequested.name,
          initial.payload,
          {
            delivery: "on-run-success",
            stepId: "reserve-initial-scope-improvement",
          },
        );
        return { disposition: "reserved" };
      },
    },
  ],
};

export default workflow;
