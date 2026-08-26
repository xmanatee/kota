import { type KotaClient, KotaClientScopeError } from "#root/client/kota-client.generated.js";
import type { ScopeSelector } from "./scope-selector.js";

type SetupClient = KotaClient["setup"];

function isUnknownScopeMessage(message: string): boolean {
  return /^Unknown scope(?::|$)/.test(message);
}

export async function runScopedKotaClientOperation<T>(
  selectedId: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (err instanceof KotaClientScopeError) throw err;
    if (err instanceof Error && isUnknownScopeMessage(err.message)) {
      throw new KotaClientScopeError(selectedId, err);
    }
    throw err;
  }
}

export function createScopedSetupClient(args: {
  base: SetupClient;
  selector: ScopeSelector;
  selectedId: string;
}): SetupClient {
  const { base, selector, selectedId } = args;
  const scoped = <T>(operation: () => Promise<T>) =>
    runScopedKotaClientOperation(selectedId, operation);
  return {
    list: () => scoped(() => base.list(selector)),
    submitForm: (moduleName, requirementId, values) =>
      scoped(() => base.submitForm(moduleName, requirementId, values, selector)),
    storeSecret: (moduleName, requirementId, secretValues) =>
      scoped(() => base.storeSecret(moduleName, requirementId, secretValues, selector)),
    start: (moduleName, requirementId) =>
      scoped(() => base.start(moduleName, requirementId, selector)),
    complete: (actionId, input) =>
      scoped(() => base.complete(actionId, input, selector)),
    refresh: (moduleName, requirementId) =>
      scoped(() => base.refresh(moduleName, requirementId, selector)),
    revoke: (moduleName, requirementId) =>
      scoped(() => base.revoke(moduleName, requirementId, selector)),
  };
}
