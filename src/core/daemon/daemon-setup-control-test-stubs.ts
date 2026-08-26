import type {
  ModuleSetupCompleteInput,
  ModuleSetupFormValues,
  ModuleSetupMutationResult,
  ModuleSetupStartResult,
  ModuleSetupStatusResponse,
} from "#core/modules/setup-requirements.js";
import type { DaemonControlHandle } from "./daemon-control-types.js";
import {
  defaultScopePolicyDecisionExamples,
  resolveScopePolicy,
} from "./scope-policy.js";

type SetupControlHandleMethods = Pick<
  DaemonControlHandle,
  | "getScopeHostingState"
  | "getScopePolicy"
  | "listDeadLetters"
  | "getDeadLetter"
  | "dismissDeadLetter"
  | "redriveDeadLetter"
  | "exportDeadLetterDiagnostics"
  | "listModuleSetupStatuses"
  | "submitModuleSetupForm"
  | "storeModuleSetupSecret"
  | "startModuleSetup"
  | "completeModuleSetup"
  | "refreshModuleSetup"
  | "revokeModuleSetup"
>;

const EMPTY_SETUP_STATUS: ModuleSetupStatusResponse = {
  visibility: "full",
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

const TEST_SCOPE_PROJECTION = {
  rootScopeId: "global",
  defaultScopeId: "test-scope-id",
  scopes: [
    { scopeId: "global", displayName: "Global" },
    {
      scopeId: "test-scope-id",
      displayName: "test-scope",
      parentScopeId: "global",
      directoryRoot: "/tmp/test-scope",
    },
    {
      scopeId: "test-feature",
      displayName: "test-feature",
      parentScopeId: "test-scope-id",
      directoryRoot: "/tmp/test-scope/feature",
    },
  ],
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
    getScopeHostingState: () => "hosted",
    getScopePolicy: (scopeId: string) => {
      const policy = resolveScopePolicy({
        projection: TEST_SCOPE_PROJECTION,
        scopeId,
      });
      return {
        revision: 0,
        policy,
        decisionExamples: defaultScopePolicyDecisionExamples(policy),
      };
    },
    listDeadLetters: () => ({
      items: [],
      counts: { open: 0, dismissed: 0, redriven: 0 },
    }),
    getDeadLetter: () => null,
    dismissDeadLetter: () => ({ ok: false, reason: "not_found" }),
    redriveDeadLetter: () => ({ ok: false, reason: "not_found" }),
    exportDeadLetterDiagnostics: () => null,
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
