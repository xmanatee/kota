import { resolve } from "node:path";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { scopeImprovementRequested } from "../scope-improver/events.js";
import { computeScopeContentFingerprint } from "../scope-improver/scope-fingerprint.js";
import {
  decodeScopeImprovementState,
  reserveScopeImprovementInput,
  SCOPE_IMPROVEMENT_STATE_KEY,
} from "../scope-improver/scope-improvement-state.js";
import type { ScopeImprovementState } from "../scope-improver/scope-improvement-types.js";
import { scopeImprovementDispatchKey } from "../scope-improver/semantic-request.js";

const workflow: WorkflowDefinitionInput = {
  name: "scope-improvement-onboarding",
  repository: "none",
  description:
    "Reserve and publish the initial scope-improvement request for a newly registered scope.",
  triggers: [
    {
      event: "scope.lifecycle.changed",
      cooldownMs: 0,
      queueMode: "all",
    },
  ],
  triggerAdmission: ({ projectDir, trigger, state: projectState }) => {
    const payload = trigger.payload;
    if (payload.transition !== "registered") {
      return { admitted: false, reason: "scope lifecycle transition is not registration" };
    }
    const scopeId = deriveDirectoryScopeId(projectDir);
    if (
      payload.affectedScopeId !== scopeId ||
      typeof payload.directoryRoot !== "string" ||
      resolve(payload.directoryRoot) !== resolve(projectDir)
    ) {
      return {
        admitted: false,
        reason: "scope lifecycle event belongs to another runtime scope",
      };
    }
    const state = decodeScopeImprovementState(
      projectState.read<ScopeImprovementState>(SCOPE_IMPROVEMENT_STATE_KEY).value,
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
        const scopeId = deriveDirectoryScopeId(ctx.scopeDir);
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
        const fingerprint = computeScopeContentFingerprint(
          ctx.scopeDir,
          ctx.scopePolicySnapshot.policy,
          ctx.stateDir,
        );
        const deliveryAttempt = 0;
        ctx.state.compareAndSet(
          SCOPE_IMPROVEMENT_STATE_KEY,
          snapshot.revision,
          reserveScopeImprovementInput(currentState, {
            fingerprint: fingerprint.fingerprint,
            boundary: "initial-onboarding",
            delivery: "queued",
            deliveryAttempt,
          }),
        );
        ctx.emit(
          scopeImprovementRequested.name,
          {
            automatic: true,
            boundary: "initial-onboarding",
            fingerprint: fingerprint.fingerprint,
            deliveryAttempt,
            idempotencyKey: scopeImprovementDispatchKey(
              scopeId,
              fingerprint.fingerprint,
              deliveryAttempt,
            ),
            evidenceRefs: fingerprint.refs,
            reason:
              "newly activated scope is ready for its initial improvement review",
            requestedBy: "scope-lifecycle:registered",
          },
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
