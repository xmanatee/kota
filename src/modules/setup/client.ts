import type {
  ModuleSetupCompleteInput,
  ModuleSetupFormValues,
  ModuleSetupMutationResult,
  ModuleSetupStartResult,
  ModuleSetupStatusResponse,
} from "#core/modules/setup-requirements.js";

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
  list(): Promise<ModuleSetupStatusResponse>;
  submitForm(
    moduleName: string,
    requirementId: string,
    values: ModuleSetupFormValues,
  ): Promise<ModuleSetupMutationResult>;
  storeSecret(
    moduleName: string,
    requirementId: string,
    secretValues: Record<string, string>,
  ): Promise<ModuleSetupMutationResult>;
  start(
    moduleName: string,
    requirementId: string,
  ): Promise<ModuleSetupStartResult>;
  complete(
    actionId: string,
    input: ModuleSetupCompleteInput,
  ): Promise<ModuleSetupMutationResult>;
  refresh(
    moduleName: string,
    requirementId: string,
  ): Promise<ModuleSetupMutationResult>;
  revoke(
    moduleName: string,
    requirementId: string,
  ): Promise<ModuleSetupMutationResult>;
}
