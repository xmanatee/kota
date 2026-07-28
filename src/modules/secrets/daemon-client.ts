import type { DaemonTransport } from "#core/server/daemon-transport.js";
import {
  appendScopeSelector,
  encodeQueryParams,
  scopeSelectorQuery,
} from "#core/server/scope-selector.js";
import {
  type SecretGetResult,
  type SecretListResult,
  type SecretMutateResult,
  type SecretProjectSelection,
  type SecretScope,
  type SecretsClient,
  secretMutationFailure,
} from "./client.js";

function secretPath(name: string, project?: SecretProjectSelection): string {
  return `/api/secrets/${encodeURIComponent(name)}${scopeSelectorQuery(project)}`;
}

function removeSecretPath(
  name: string,
  scope: SecretScope,
  project?: SecretProjectSelection,
): string {
  const params = new URLSearchParams({ scope });
  appendScopeSelector(params, project);
  return `/api/secrets/${encodeURIComponent(name)}?${encodeQueryParams(params)}`;
}

async function mutateSecret(
  operation: () => Promise<SecretMutateResult>,
): Promise<SecretMutateResult> {
  try {
    return await operation();
  } catch (cause) {
    return secretMutationFailure(
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}

export function buildSecretsDaemonHandler(link: DaemonTransport): SecretsClient {
  return {
    list: (project): Promise<SecretListResult> =>
      link.requestStrict<SecretListResult>(
        "GET",
        `/api/secrets${scopeSelectorQuery(project)}`,
      ),
    get: (name, project): Promise<SecretGetResult> =>
      link.requestStrict<SecretGetResult>("GET", secretPath(name, project)),
    set: (name, value, scope, project): Promise<SecretMutateResult> =>
      mutateSecret(() =>
        link.requestStrict<SecretMutateResult>(
          "PUT",
          secretPath(name, project),
          { value, scope },
        ),
      ),
    remove: (name, scope, project): Promise<SecretMutateResult> =>
      mutateSecret(() =>
        link.requestStrict<SecretMutateResult>(
          "DELETE",
          removeSecretPath(name, scope, project),
        ),
      ),
  };
}
