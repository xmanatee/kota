import type { KotaConfig } from "#core/config/config.js";
import type { SecretScope } from "#core/config/secrets.js";
import type { ScopeSetupVisibility } from "#core/daemon/scope-policy.js";

export type ModuleSetupScope = "project" | "global";
export type ModuleSetupSensitivity = "none" | "secret" | "oauth" | "browser-profile";
export type ModuleSetupStatusState =
  | "ready"
  | "missing"
  | "pending"
  | "expired"
  | "revoked"
  | "unknown"
  | "unavailable";

export type ModuleSetupFormValue = string | number | boolean;
export type ModuleSetupFormValues = Record<string, ModuleSetupFormValue>;
export type ModuleSetupJsonValue =
  | string
  | number
  | boolean
  | null
  | ModuleSetupJsonValue[]
  | { [key: string]: ModuleSetupJsonValue };

export type ModuleSetupFormField = {
  id: string;
  label: string;
  type: "string" | "number" | "boolean";
  valueKind?: "secret-reference";
  configPath: string;
  required: boolean;
  placeholder?: string;
  helperText?: string;
  options?: readonly { value: string; label: string }[];
};

export type ModuleSetupSecretRef = {
  name: string;
  scope: SecretScope;
};

export type ModuleSetupUrlMode = {
  mode: "url";
  url: string;
  label: string;
  pendingTtlMs?: number;
};

export type ModuleSetupFormMode = {
  mode: "form";
  fields: readonly ModuleSetupFormField[];
};

export type ModuleSetupNoMode = {
  mode: "none";
};

export type ModuleSetupBase = {
  id: string;
  title: string;
  description?: string;
  required: boolean;
  scope: ModuleSetupScope;
  owner?: string;
  health?: { capabilityIds: readonly string[] };
};

export type ModuleSetupConfigRequirement = ModuleSetupBase & {
  kind: "config";
  sensitivity: "none";
  setup: ModuleSetupFormMode;
};

export type ModuleSetupSecretRequirement = ModuleSetupBase & {
  kind: "secret";
  sensitivity: "secret";
  setup: ModuleSetupUrlMode;
  secretRefs: readonly ModuleSetupSecretRef[];
};

export type ModuleSetupOAuthRequirement = ModuleSetupBase & {
  kind: "oauth";
  sensitivity: "oauth";
  setup: ModuleSetupUrlMode;
  secretRefs: readonly ModuleSetupSecretRef[];
  reauth: boolean;
};

export type ModuleSetupBrowserProfileRequirement = ModuleSetupBase & {
  kind: "browser-profile";
  sensitivity: "browser-profile";
  setup: ModuleSetupFormMode;
  storageStateConfigPath: string;
};

export type ModuleSetupExternalUrlRequirement = ModuleSetupBase & {
  kind: "external-url";
  sensitivity: "none" | "secret" | "oauth";
  setup: ModuleSetupUrlMode;
  completionConfigPaths?: readonly string[];
  secretRefs?: readonly ModuleSetupSecretRef[];
};

export type ModuleSetupCapabilityRequirement = ModuleSetupBase & {
  kind: "capability";
  sensitivity: "none";
  setup: ModuleSetupNoMode;
  capabilityIds: readonly string[];
};

export type ModuleSetupRequirement =
  | ModuleSetupConfigRequirement
  | ModuleSetupSecretRequirement
  | ModuleSetupOAuthRequirement
  | ModuleSetupBrowserProfileRequirement
  | ModuleSetupExternalUrlRequirement
  | ModuleSetupCapabilityRequirement;

export type ModuleSetupRequirementContribution = {
  moduleName: string;
  requirement: ModuleSetupRequirement;
};

export type ModuleSetupCapabilityStatus = {
  id: string;
  status: "ready" | "unavailable" | "init_failed";
  reason?: string;
  message?: string;
};

export type ModuleSetupSecretStatus = ModuleSetupSecretRef & {
  present: boolean;
  source?: string;
};

export type ModuleSetupConfigFieldStatus = {
  id: string;
  label: string;
  configPath: string;
  required: boolean;
  present: boolean;
};

export type ModuleSetupPendingAction = {
  actionId: string;
  moduleName: string;
  requirementId: string;
  url: string;
  label: string;
  status: "pending" | "completed" | "revoked";
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
};

export type ModuleSetupRequirementStatus = {
  moduleName: string;
  requirementId: string;
  kind: ModuleSetupRequirement["kind"];
  title: string;
  description?: string;
  required: boolean;
  scope: ModuleSetupScope;
  owner?: string;
  sensitivity: ModuleSetupSensitivity;
  setup: ModuleSetupRequirement["setup"];
  state: ModuleSetupStatusState;
  reason: string;
  message: string;
  secretRefs?: ModuleSetupSecretStatus[];
  configFields?: ModuleSetupConfigFieldStatus[];
  capabilities?: ModuleSetupCapabilityStatus[];
  pendingAction?: ModuleSetupPendingAction;
};

export type ModuleSetupStatusResponse = {
  visibility: ScopeSetupVisibility;
  requirements: ModuleSetupRequirementStatus[];
  summary: Record<ModuleSetupStatusState, number>;
};

export type ModuleSetupFailureResult = {
  ok: false;
  reason: "not_found" | "invalid_request" | "store_error" | "policy_denied";
  message: string;
};

export type ModuleSetupMutationResult =
  | { ok: true; status: ModuleSetupRequirementStatus }
  | ModuleSetupFailureResult;

export type ModuleSetupStartResult =
  | {
      ok: true;
      action: ModuleSetupPendingAction;
      status: ModuleSetupRequirementStatus;
    }
  | ModuleSetupFailureResult;

export type ModuleSetupCompleteInput = {
  secretValues?: Record<string, string>;
  configValues?: ModuleSetupFormValues;
};

export type ModuleSetupServiceOptions = {
  projectDir: string;
  /** Machine-owned config document that supplies this project's trust decision. */
  authorityConfigPath?: string;
  getRequirements: () => readonly ModuleSetupRequirementContribution[];
  probeCapabilities: () => Promise<readonly ModuleSetupCapabilityStatus[]>;
  now?: () => Date;
  getVisibility?: () => ScopeSetupVisibility;
};

export type ModuleSetupActionFile = {
  actions: ModuleSetupPendingAction[];
};

export type SetupConfigObject = { [key: string]: ModuleSetupJsonValue };

export type ModuleSetupStatusInput = {
  entry: ModuleSetupRequirementContribution;
  config: KotaConfig;
  capabilities: readonly ModuleSetupCapabilityStatus[];
  pendingAction: ModuleSetupPendingAction | undefined;
  now: Date;
  projectDir: string;
};
