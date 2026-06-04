import type {
  ModuleSetupCompleteInput,
  ModuleSetupFormValues,
  ModuleSetupMutationResult,
  ModuleSetupStartResult,
  ModuleSetupStatusResponse,
} from "#core/modules/setup-requirements.js";
import type { DaemonControlHandle } from "./daemon-control-types.js";

type SetupControlHandleMethods = Pick<
  DaemonControlHandle,
  | "listModuleSetupStatuses"
  | "submitModuleSetupForm"
  | "storeModuleSetupSecret"
  | "startModuleSetup"
  | "completeModuleSetup"
  | "refreshModuleSetup"
  | "revokeModuleSetup"
>;

const EMPTY_SETUP_STATUS: ModuleSetupStatusResponse = {
  requirements: [],
  summary: {
    ready: 0,
    missing: 0,
    pending: 0,
    expired: 0,
    revoked: 0,
    unknown: 0,
    unavailable: 0,
  },
};

function missingSetupResult(): ModuleSetupMutationResult {
  return {
    ok: false,
    reason: "not_found",
    message: "No setup requirement is registered in this test handle.",
  };
}

function missingSetupStartResult(): ModuleSetupStartResult {
  return {
    ok: false,
    reason: "not_found",
    message: "No setup requirement is registered in this test handle.",
  };
}

export function daemonSetupControlHandleStubs(): SetupControlHandleMethods {
  return {
    listModuleSetupStatuses: async () => EMPTY_SETUP_STATUS,
    submitModuleSetupForm: async (
      _moduleName: string,
      _requirementId: string,
      _values: ModuleSetupFormValues,
    ) => missingSetupResult(),
    storeModuleSetupSecret: async (
      _moduleName: string,
      _requirementId: string,
      _secretValues: Record<string, string>,
    ) => missingSetupResult(),
    startModuleSetup: async (_moduleName: string, _requirementId: string) =>
      missingSetupStartResult(),
    completeModuleSetup: async (
      _actionId: string,
      _input: ModuleSetupCompleteInput,
    ) => missingSetupResult(),
    refreshModuleSetup: async (_moduleName: string, _requirementId: string) =>
      missingSetupResult(),
    revokeModuleSetup: async (_moduleName: string, _requirementId: string) =>
      missingSetupResult(),
  };
}
