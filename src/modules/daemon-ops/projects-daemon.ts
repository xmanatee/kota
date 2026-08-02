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
  ConfiguredProject,
  ProjectId,
  ProjectRegistryProjection,
} from "#core/daemon/scope-registry.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import type {
  ProjectsClient,
  ProjectsUseResult,
} from "./client.js";
import { daemonResponseError } from "./daemon-response-error.js";

type ProjectsListWireBody = ProjectRegistryProjection & {
  activeProjectId: ProjectId | null;
};

export function buildProjectsDaemonHandler(link: DaemonTransport): ProjectsClient {
  return {
    list: async () => {
      const res = await link.fetchRaw("/projects", {
        method: "GET",
        headers: link.authHeaders(),
      });
      if (!res.ok) throw await daemonResponseError(res);
      const parsed = (await res.json()) as ProjectsListWireBody;
      return {
        ok: true,
        projects: parsed.projects as ConfiguredProject[],
        defaultProjectId: parsed.defaultProjectId,
        activeProjectId: parsed.activeProjectId,
      };
    },
    use: async (projectId: string | null): Promise<ProjectsUseResult> => {
      const res = await link.fetchRaw("/projects/active", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...link.authHeaders() },
        body: JSON.stringify({ projectId }),
      });
      if (res.status === 404) {
        const body = (await res.json()) as { projectId?: string };
        return {
          ok: false,
          reason: "not_found",
          projectId: body.projectId ?? (projectId ?? ""),
        };
      }
      if (!res.ok) throw await daemonResponseError(res);
      const body = (await res.json()) as { activeProjectId: ProjectId | null };
      return { ok: true, activeProjectId: body.activeProjectId };
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
      const operatorChallenge = scopeAuthorityOperatorChallengeForInteractiveClient();
      if (!operatorChallenge.ok) {
        return {
          ok: false,
          reason: "operator_action_required",
          message: operatorChallenge.message,
          scopeId,
          currentRevision: mutation.expectedRevision,
        };
      }
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
      const requestBody = JSON.stringify(mutation);
      const operatorHeaders = scopeAuthorityOperatorHeadersForInteractiveClient(
        {
          value: operatorAction,
          scopeId,
          body: requestBody,
          challenge: operatorChallenge.challenge,
        },
        challengeBody.proof,
      );
      if (!operatorHeaders.ok) {
        return {
          ok: false,
          reason: "operator_action_required",
          message: operatorHeaders.message,
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
            ...operatorHeaders.headers,
            ...link.authHeaders(),
          },
          body: requestBody,
        },
      );
      return (await res.json()) as ScopeAuthorityMutationResult;
    },
  };
}
