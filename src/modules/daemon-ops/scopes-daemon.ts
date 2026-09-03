import {
  SCOPE_AUTHORITY_OPERATOR_CHALLENGE_HEADER,
  SCOPE_AUTHORITY_OPERATOR_CHALLENGE_PATH,
  scopeAuthorityOperatorChallengeForInteractiveClient,
  scopeAuthorityOperatorHeadersForInteractiveClient,
} from "#core/daemon/scope-authority-operator-token.js";
import type {
  ScopeAuthorityFailure,
  ScopeAuthorityMutationResult,
  ScopeAuthorityValidationResult,
  ScopeAuthorityView,
} from "#core/daemon/scope-authority-types.js";
import type {
  ScopeOnboardingApplyResult,
  ScopeOnboardingInspection,
  ScopeOnboardingOperation,
  ScopeOnboardingPlan,
  ScopeOnboardingPlanResult,
} from "#core/daemon/scope-onboarding.js";
import type {
  ScopeId,
  ScopeRegistryProjection,
} from "#core/daemon/scope-registry.js";
import { directoryScopesFromProjection } from "#core/daemon/scope-registry.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  ScopesClient,
  ScopesUseResult,
} from "./client.js";
import { daemonResponseError } from "./daemon-response-error.js";

type ScopesListWireBody = ScopeRegistryProjection & {
  activeScopeId: ScopeId | null;
};

function acceptedPlanBody(plan: ScopeOnboardingPlan): string {
  return JSON.stringify({
    planId: plan.planId,
    operationId: plan.operationId,
    inspectionId: plan.inspectionId,
    directoryRoot: plan.directoryRoot,
    createdAt: plan.createdAt,
    choices: plan.choices,
  });
}

async function operatorHeaders(
  link: DaemonTransport,
  request: {
    value: "apply" | "confirm-dangerous";
    scopeId: string;
    body: string;
  },
): Promise<ReturnType<typeof scopeAuthorityOperatorHeadersForInteractiveClient>> {
  const operatorChallenge = scopeAuthorityOperatorChallengeForInteractiveClient();
  if (!operatorChallenge.ok) return operatorChallenge;
  const challengeResponse = await link.fetchRaw(
    SCOPE_AUTHORITY_OPERATOR_CHALLENGE_PATH,
    {
      method: "POST",
      headers: {
        [SCOPE_AUTHORITY_OPERATOR_CHALLENGE_HEADER]: operatorChallenge.challenge,
        ...link.authHeaders(),
      },
    },
  );
  const challengeBody = challengeResponse.ok
    ? await challengeResponse.json() as { proof?: string }
    : {};
  return scopeAuthorityOperatorHeadersForInteractiveClient(
    { ...request, challenge: operatorChallenge.challenge },
    challengeBody.proof,
  );
}

export function buildScopesDaemonHandler(link: DaemonTransport): ScopesClient {
  return {
    list: async () => {
      const res = await link.fetchRaw("/scopes", {
        method: "GET",
        headers: link.authHeaders(),
      });
      if (!res.ok) throw await daemonResponseError(res);
      const parsed = (await res.json()) as ScopesListWireBody;
      return {
        ok: true,
        scopes: directoryScopesFromProjection(parsed),
        defaultScopeId: parsed.defaultScopeId,
        activeScopeId: parsed.activeScopeId,
      };
    },
    use: async (scopeId: string | null): Promise<ScopesUseResult> => {
      const res = await link.fetchRaw("/scopes/active", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...link.authHeaders() },
        body: JSON.stringify({ scopeId }),
      });
      if (res.status === 404) {
        const body = (await res.json()) as { scopeId?: string };
        return {
          ok: false,
          reason: "not_found",
          scopeId: body.scopeId ?? (scopeId ?? ""),
        };
      }
      if (res.status === 409) {
        const body = (await res.json()) as {
          reason?: string;
          scopeId?: string;
          state?: "inactive" | "draining" | "drained";
        };
        if (body.reason === "scope_not_hosted" && body.state !== undefined) {
          return {
            ok: false,
            reason: "not_hosted",
            scopeId: body.scopeId ?? (scopeId ?? ""),
            state: body.state,
          };
        }
      }
      if (!res.ok) throw await daemonResponseError(res);
      const body = (await res.json()) as { activeScopeId: ScopeId | null };
      return { ok: true, activeScopeId: body.activeScopeId };
    },
    inspectAuthority: async (scopeId) => {
      const res = await link.fetchRaw(
        `/scopes/${encodeURIComponent(scopeId)}/authority`,
        { method: "GET", headers: link.authHeaders() },
      );
      const body = (await res.json()) as ScopeAuthorityView | ScopeAuthorityFailure;
      if (!res.ok) return body as ScopeAuthorityFailure;
      return { ok: true, authority: body as ScopeAuthorityView };
    },
    validateAuthority: async (scopeId, mutation) => {
      const res = await link.fetchRaw(
        `/scopes/${encodeURIComponent(scopeId)}/authority/validate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...link.authHeaders() },
          body: JSON.stringify(mutation),
        },
      );
      return (await res.json()) as ScopeAuthorityValidationResult;
    },
    applyAuthority: async (scopeId, mutation, operatorAction) => {
      const requestBody = JSON.stringify(mutation);
      const signed = await operatorHeaders(link, {
        value: operatorAction,
        scopeId,
        body: requestBody,
      });
      if (!signed.ok) {
        return {
          ok: false,
          reason: "operator_action_required",
          message: signed.message,
          scopeId,
          currentRevision: mutation.expectedRevision,
        };
      }
      const res = await link.fetchRaw(
        `/scopes/${encodeURIComponent(scopeId)}/authority`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...signed.headers,
            ...link.authHeaders(),
          },
          body: requestBody,
        },
      );
      return (await res.json()) as ScopeAuthorityMutationResult;
    },
    inspectOnboarding: async (directoryRoot) => {
      const res = await link.fetchRaw("/scope-onboarding/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...link.authHeaders() },
        body: JSON.stringify({ directoryRoot }),
      });
      const body = await res.json() as ScopeOnboardingInspection | {
        ok: false;
        reason: "invalid_directory";
        message: string;
      };
      return res.ok
        ? { ok: true, inspection: body as ScopeOnboardingInspection }
        : body as { ok: false; reason: "invalid_directory"; message: string };
    },
    planOnboarding: async (directoryRoot, choices = {}) => {
      const res = await link.fetchRaw("/scope-onboarding/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...link.authHeaders() },
        body: JSON.stringify({ directoryRoot, choices }),
      });
      return await res.json() as ScopeOnboardingPlanResult;
    },
    applyOnboarding: async (plan, operatorAction) => {
      const requestBody = acceptedPlanBody(plan);
      const signed = await operatorHeaders(link, {
        value: operatorAction,
        scopeId: plan.scopeId,
        body: requestBody,
      });
      if (!signed.ok) {
        return {
          ok: false,
          reason: "operator_action_required",
          message: signed.message,
        };
      }
      const res = await link.fetchRaw("/scope-onboarding/apply", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...signed.headers,
          ...link.authHeaders(),
        },
        body: requestBody,
      });
      return await res.json() as ScopeOnboardingApplyResult;
    },
    getOnboardingStatus: async (operationId) => {
      const res = await link.fetchRaw(
        `/scope-onboarding/${encodeURIComponent(operationId)}`,
        { method: "GET", headers: link.authHeaders() },
      );
      return await res.json() as
        | { ok: true; operation: ScopeOnboardingOperation }
        | { ok: false; reason: "not_found"; message: string };
    },
    retryOnboarding: async (operationId, scopeId, operatorAction) => {
      const requestBody = "{}";
      const signed = await operatorHeaders(link, {
        value: operatorAction,
        scopeId,
        body: requestBody,
      });
      if (!signed.ok) {
        return {
          ok: false,
          reason: "operator_action_required",
          message: signed.message,
        };
      }
      const res = await link.fetchRaw(
        `/scope-onboarding/${encodeURIComponent(operationId)}/retry`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...signed.headers,
            ...link.authHeaders(),
          },
          body: requestBody,
        },
      );
      return await res.json() as ScopeOnboardingApplyResult;
    },
    cancelOnboarding: async (operationId) => {
      const res = await link.fetchRaw(
        `/scope-onboarding/${encodeURIComponent(operationId)}`,
        { method: "DELETE", headers: link.authHeaders() },
      );
      return await res.json() as ScopeOnboardingApplyResult;
    },
    drain: async (scopeId) => {
      const res = await link.fetchRaw(
        `/scopes/${encodeURIComponent(scopeId)}/drain`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...link.authHeaders() },
          body: "{}",
        },
      );
      return await res.json() as Awaited<ReturnType<ScopesClient["drain"]>>;
    },
    remove: async (scopeId) => {
      const res = await link.fetchRaw(
        `/scopes/${encodeURIComponent(scopeId)}`,
        { method: "DELETE", headers: link.authHeaders() },
      );
      return await res.json() as Awaited<ReturnType<ScopesClient["remove"]>>;
    },
  };
}
