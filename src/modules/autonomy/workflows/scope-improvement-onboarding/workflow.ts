import { join, resolve } from "node:path";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import { expectStructuredOutput } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { scopeImprovementRequested } from "../scope-improver/events.js";
import {
  decodeScopeImprovementState,
  SCOPE_IMPROVEMENT_STATE_KEY,
} from "../scope-improver/scope-improvement-state.js";
import type { ScopeImprovementState } from "../scope-improver/scope-improvement-types.js";
import { observeScopeImprovement, reserveInitialScopeImprovement, type ScopeImprovementObservation } from "./initial-request.js";

const observationArtifact = "scope-onboarding-observation.json";

const workflow: WorkflowDefinitionInput = {
  name: "scope-improvement-onboarding",
  repository: "none",
  description:
    "Reserve and publish the initial scope-improvement request after onboarding commits.",
  finalize: (ctx) => {
    const observation = expectStructuredOutput<ScopeImprovementObservation>(
      readOptionalJsonFile(join(ctx.stateDir, "runs", ctx.runId, observationArtifact)), ["eligible"],
    );
    const snapshot = ctx.state.read(SCOPE_IMPROVEMENT_STATE_KEY);
    const initial = reserveInitialScopeImprovement(decodeScopeImprovementState(snapshot.value, ctx.scopeId), observation);
    if (!initial.shouldEmit || !initial.payload || !initial.nextState) return;
    ctx.state.compareAndSet(SCOPE_IMPROVEMENT_STATE_KEY, snapshot.revision, initial.nextState);
    ctx.emit(scopeImprovementRequested.name, initial.payload, "reserve-initial-scope-improvement");
  },
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
      rerunOnRetry: true,
      run: (ctx) => {
        if (!ctx.scopePolicySnapshot) {
          throw new Error(
            "scope onboarding requires an authoritative resolved scope-policy snapshot",
          );
        }
        const observation = observeScopeImprovement({
          scopeRoot: ctx.scopeRoot, stateDir: ctx.stateDir,
          scopePolicySnapshot: ctx.scopePolicySnapshot,
        });
        writeJsonFileAtomic(join(ctx.workflow.runDirPath, observationArtifact), observation);
        return { disposition: "observed", observation };
      },
    },
  ],
};

export default workflow;
