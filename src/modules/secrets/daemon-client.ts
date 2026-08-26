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
  type SecretScope,
  type SecretScopeSelection,
  type SecretsClient,
  secretMutationFailure,
} from "./client.js";

function secretPath(name: string, selector?: SecretScopeSelection): string {
  return `/api/secrets/${encodeURIComponent(name)}${scopeSelectorQuery(selector)}`;
}

function removeSecretPath(
  name: string,
  scope: SecretScope,
  selector?: SecretScopeSelection,
): string {
  const params = new URLSearchParams({ scope });
  appendScopeSelector(params, selector);
  return `/api/secrets/${encodeURIComponent(name)}?${encodeQueryParams(params)}`;
}

async function mutateSecret(
  operation: () => Promise<SecretMutateResult>,
): Promise<SecretMutateResult> {
  try {
    return await operation();
  } catch (cause) {
    return secretMutationFailure(
      cause instanceof Error ? cause : new Error(String(cause)),
    );
  }
}

export function buildSecretsDaemonHandler(link: DaemonTransport): SecretsClient {
  return {
    list: (scopeSelector): Promise<SecretListResult> =>
      link.requestStrict<SecretListResult>(
        "GET",
        `/api/secrets${scopeSelectorQuery(scopeSelector)}`,
      ),
    get: (name, scopeSelector): Promise<SecretGetResult> =>
      link.requestStrict<SecretGetResult>("GET", secretPath(name, scopeSelector)),
    set: (name, value, scope, scopeSelector): Promise<SecretMutateResult> =>
      mutateSecret(() =>
        link.requestStrict<SecretMutateResult>(
          "PUT",
          secretPath(name, scopeSelector),
          { value, scope },
        ),
      ),
    remove: (name, scope, scopeSelector): Promise<SecretMutateResult> =>
      mutateSecret(() =>
        link.requestStrict<SecretMutateResult>(
          "DELETE",
          removeSecretPath(name, scope, scopeSelector),
        ),
      ),
  };
}
