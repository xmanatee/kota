import type {
  ModuleSetupCompleteInput,
  ModuleSetupFormValues,
  ModuleSetupMutationResult,
  ModuleSetupStartResult,
  ModuleSetupStatusResponse,
} from "#core/modules/setup-requirements.js";
import type { ScopeSelector } from "#core/server/scope-selector.js";

export type {
  ModuleSetupCompleteInput,
  ModuleSetupConfigFieldStatus,
  ModuleSetupFormField,
  ModuleSetupFormValue,
  ModuleSetupFormValues,
  ModuleSetupMutationResult,
  ModuleSetupPendingAction,
  ModuleSetupRequirementStatus,
  ModuleSetupSecretStatus,
  ModuleSetupStartResult,
  ModuleSetupStatusResponse,
} from "#core/modules/setup-requirements.js";

export interface SetupClient {
  list(scope?: ScopeSelector): Promise<ModuleSetupStatusResponse>;
  submitForm(
    moduleName: string,
    requirementId: string,
    values: ModuleSetupFormValues,
    scope?: ScopeSelector,
  ): Promise<ModuleSetupMutationResult>;
  storeSecret(
    moduleName: string,
    requirementId: string,
    secretValues: Record<string, string>,
    scope?: ScopeSelector,
  ): Promise<ModuleSetupMutationResult>;
  start(
    moduleName: string,
    requirementId: string,
    scope?: ScopeSelector,
  ): Promise<ModuleSetupStartResult>;
  complete(
    actionId: string,
    input: ModuleSetupCompleteInput,
    scope?: ScopeSelector,
  ): Promise<ModuleSetupMutationResult>;
  refresh(
    moduleName: string,
    requirementId: string,
    scope?: ScopeSelector,
  ): Promise<ModuleSetupMutationResult>;
  revoke(
    moduleName: string,
    requirementId: string,
    scope?: ScopeSelector,
  ): Promise<ModuleSetupMutationResult>;
}
