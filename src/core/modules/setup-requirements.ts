import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { type KotaConfig, loadConfig, updateProjectConfig } from "#core/config/config.js";
import {
  getSecretStore,
  initSecretStore,
  type SecretScope,
} from "#core/config/secrets.js";

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
  requirements: ModuleSetupRequirementStatus[];
  summary: Record<ModuleSetupStatusState, number>;
};

export type ModuleSetupFailureResult = {
  ok: false;
  reason: "not_found" | "invalid_request" | "store_error";
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

type ModuleSetupActionFile = {
  actions: ModuleSetupPendingAction[];
};

type SetupConfigObject = { [key: string]: ModuleSetupJsonValue };

const ID_PATTERN = /^[a-z][a-z0-9.-]*$/;
const SECRET_REFERENCE_PATTERN = /^\$[A-Z][A-Z0-9_]*$/;
const DEFAULT_PENDING_TTL_MS = 10 * 60 * 1000;
const SETUP_KINDS = [
  "config",
  "secret",
  "oauth",
  "browser-profile",
  "external-url",
  "capability",
] as const;
const SETUP_SCOPES = ["project", "global"] as const;
const SETUP_SENSITIVITIES = ["none", "secret", "oauth", "browser-profile"] as const;
const SETUP_MODES = ["form", "url", "none"] as const;
const FORM_FIELD_TYPES = ["string", "number", "boolean"] as const;

export function validateModuleSetupRequirements(
  moduleName: string,
  requirements: readonly ModuleSetupRequirement[],
): void {
  const seen = new Set<string>();
  for (const req of requirements) {
    validateCommon(moduleName, req, seen);
    switch (req.kind) {
      case "config":
        validateKindShape(moduleName, req, "none", "form");
        validateFormRequirement(moduleName, req);
        break;
      case "secret":
        validateKindShape(moduleName, req, "secret", "url");
        validateUrlRequirement(moduleName, req);
        validateSecretRefs(moduleName, req.id, req.secretRefs);
        break;
      case "oauth":
        validateKindShape(moduleName, req, "oauth", "url");
        validateUrlRequirement(moduleName, req);
        validateSecretRefs(moduleName, req.id, req.secretRefs);
        break;
      case "browser-profile":
        validateKindShape(moduleName, req, "browser-profile", "form");
        validateFormRequirement(moduleName, req);
        validateConfigPath(moduleName, req.id, req.storageStateConfigPath);
        break;
      case "external-url":
        validateExternalUrlShape(moduleName, req.id, req.sensitivity, req.setup.mode);
        validateUrlRequirement(moduleName, req);
        if (req.secretRefs) validateSecretRefs(moduleName, req.id, req.secretRefs);
        for (const path of req.completionConfigPaths ?? []) {
          validateConfigPath(moduleName, req.id, path);
        }
        break;
      case "capability":
        validateKindShape(moduleName, req, "none", "none");
        if (req.capabilityIds.length === 0) {
          throw new Error(
            `Module "${moduleName}" setup requirement "${req.id}" must declare at least one capability id`,
          );
        }
        break;
    }
  }
}

function validateExternalUrlShape(
  moduleName: string,
  requirementId: string,
  sensitivity: ModuleSetupSensitivity,
  setupMode: ModuleSetupRequirement["setup"]["mode"],
): void {
  if (sensitivity === "browser-profile") {
    throw new Error(
      `Module "${moduleName}" setup requirement "${requirementId}" with kind "external-url" cannot use "browser-profile" sensitivity`,
    );
  }
  if (setupMode !== "url") {
    throw new Error(
      `Module "${moduleName}" setup requirement "${requirementId}" must use url setup`,
    );
  }
}

function isLiteral<T extends string>(
  value: string,
  allowed: readonly T[],
): value is T {
  return allowed.includes(value as T);
}

function validateCommon(
  moduleName: string,
  req: ModuleSetupRequirement,
  seen: Set<string>,
): void {
  const setup = req.setup;
  if (!isLiteral(req.kind, SETUP_KINDS)) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" has unknown kind "${req.kind}"`,
    );
  }
  if (!isLiteral(req.scope, SETUP_SCOPES)) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" has unknown scope "${req.scope}"`,
    );
  }
  if (!isLiteral(req.sensitivity, SETUP_SENSITIVITIES)) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" has unknown sensitivity "${req.sensitivity}"`,
    );
  }
  if (typeof setup !== "object" || setup === null) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" must declare setup`,
    );
  }
  if (!isLiteral(setup.mode, SETUP_MODES)) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" has unknown setup mode "${setup.mode}"`,
    );
  }
  if (!ID_PATTERN.test(req.id)) {
    throw new Error(
      `Module "${moduleName}" setup requirement id "${req.id}" must match ${ID_PATTERN.source}`,
    );
  }
  if (seen.has(req.id)) {
    throw new Error(
      `Module "${moduleName}" declares duplicate setup requirement id "${req.id}"`,
    );
  }
  seen.add(req.id);
  if (req.title.trim() === "") {
    throw new Error(`Module "${moduleName}" setup requirement "${req.id}" title is empty`);
  }
  for (const capabilityId of req.health?.capabilityIds ?? []) {
    if (capabilityId.trim() === "") {
      throw new Error(
        `Module "${moduleName}" setup requirement "${req.id}" has an empty health capability id`,
      );
    }
  }
}

function validateKindShape(
  moduleName: string,
  req: ModuleSetupRequirement,
  sensitivity: ModuleSetupSensitivity,
  setupMode: ModuleSetupRequirement["setup"]["mode"],
): void {
  if (req.sensitivity !== sensitivity) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" with kind "${req.kind}" must use "${sensitivity}" sensitivity`,
    );
  }
  if (req.setup.mode !== setupMode) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" with kind "${req.kind}" must use "${setupMode}" setup`,
    );
  }
}

function validateFormRequirement(
  moduleName: string,
  req:
    | ModuleSetupConfigRequirement
    | ModuleSetupBrowserProfileRequirement,
): void {
  if (req.setup.fields.length === 0) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" must declare at least one form field`,
    );
  }
  const fieldIds = new Set<string>();
  for (const field of req.setup.fields) {
    if (!ID_PATTERN.test(field.id)) {
      throw new Error(
        `Module "${moduleName}" setup requirement "${req.id}" field id "${field.id}" must match ${ID_PATTERN.source}`,
      );
    }
    if (fieldIds.has(field.id)) {
      throw new Error(
        `Module "${moduleName}" setup requirement "${req.id}" declares duplicate field "${field.id}"`,
      );
    }
    fieldIds.add(field.id);
    if (!isLiteral(field.type, FORM_FIELD_TYPES)) {
      throw new Error(
        `Module "${moduleName}" setup requirement "${req.id}" field "${field.id}" has unknown type "${field.type}"`,
      );
    }
    if (field.valueKind !== undefined && field.valueKind !== "secret-reference") {
      throw new Error(
        `Module "${moduleName}" setup requirement "${req.id}" field "${field.id}" has unknown valueKind "${field.valueKind}"`,
      );
    }
    if (field.valueKind === "secret-reference" && field.type !== "string") {
      throw new Error(
        `Module "${moduleName}" setup requirement "${req.id}" field "${field.id}" must be a string to accept secret references`,
      );
    }
    validateConfigPath(moduleName, req.id, field.configPath);
  }
}

function validateUrlRequirement(
  moduleName: string,
  req:
    | ModuleSetupSecretRequirement
    | ModuleSetupOAuthRequirement
    | ModuleSetupExternalUrlRequirement,
): void {
  if (req.setup.url.trim() === "" || req.setup.label.trim() === "") {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" must declare a URL and label`,
    );
  }
  if (req.setup.pendingTtlMs !== undefined && req.setup.pendingTtlMs <= 0) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${req.id}" pendingTtlMs must be positive`,
    );
  }
}

function validateSecretRefs(
  moduleName: string,
  requirementId: string,
  refs: readonly ModuleSetupSecretRef[],
): void {
  if (refs.length === 0) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${requirementId}" must declare at least one secret ref`,
    );
  }
  for (const ref of refs) {
    if (ref.name.trim() === "") {
      throw new Error(
        `Module "${moduleName}" setup requirement "${requirementId}" has an empty secret name`,
      );
    }
  }
}

function validateConfigPath(
  moduleName: string,
  requirementId: string,
  path: string,
): void {
  if (path.split(".").some((part) => part.trim() === "")) {
    throw new Error(
      `Module "${moduleName}" setup requirement "${requirementId}" has invalid config path "${path}"`,
    );
  }
}

export type ModuleSetupServiceOptions = {
  projectDir: string;
  getRequirements: () => readonly ModuleSetupRequirementContribution[];
  probeCapabilities: () => Promise<readonly ModuleSetupCapabilityStatus[]>;
  now?: () => Date;
};

export class ModuleSetupService {
  readonly #projectDir: string;
  readonly #getRequirements: () => readonly ModuleSetupRequirementContribution[];
  readonly #probeCapabilities: () => Promise<readonly ModuleSetupCapabilityStatus[]>;
  readonly #now: () => Date;

  constructor(options: ModuleSetupServiceOptions) {
    this.#projectDir = options.projectDir;
    this.#getRequirements = options.getRequirements;
    this.#probeCapabilities = options.probeCapabilities;
    this.#now = options.now ?? (() => new Date());
  }

  async list(): Promise<ModuleSetupStatusResponse> {
    const capabilities = await this.#probeCapabilities();
    const statuses = this.#getRequirements().map((entry) =>
      this.#statusFor(entry, this.#loadProjectConfig(), capabilities),
    );
    return { requirements: statuses, summary: summarizeStatuses(statuses) };
  }

  async refresh(
    moduleName: string,
    requirementId: string,
  ): Promise<ModuleSetupMutationResult> {
    const found = this.#find(moduleName, requirementId);
    if (!found) return notFound(moduleName, requirementId);
    return { ok: true, status: await this.#freshStatus(found) };
  }

  async submitForm(
    moduleName: string,
    requirementId: string,
    values: ModuleSetupFormValues,
  ): Promise<ModuleSetupMutationResult> {
    const found = this.#find(moduleName, requirementId);
    if (!found) return notFound(moduleName, requirementId);
    if (found.requirement.setup.mode !== "form") {
      return invalidRequest("Requirement does not accept form setup");
    }
    for (const field of found.requirement.setup.fields) {
      const value = values[field.id];
      if (value === undefined) {
        if (field.required) return invalidRequest(`Missing required field "${field.id}"`);
        continue;
      }
      if (typeof value !== field.type) {
        return invalidRequest(`Field "${field.id}" must be ${field.type}`);
      }
      if (field.valueKind === "secret-reference" && (
        typeof value !== "string" ||
        !SECRET_REFERENCE_PATTERN.test(value)
      )) {
        return invalidRequest(
          `Field "${field.id}" must be a secret reference like $GOOGLE_CLIENT_SECRET`,
        );
      }
      setProjectConfigPath(this.#projectDir, field.configPath, value);
    }
    return { ok: true, status: await this.#freshStatus(found) };
  }

  async storeSecret(
    moduleName: string,
    requirementId: string,
    secretValues: Record<string, string>,
  ): Promise<ModuleSetupMutationResult> {
    const found = this.#find(moduleName, requirementId);
    if (!found) return notFound(moduleName, requirementId);
    const refs = secretRefsFor(found.requirement);
    if (refs.length === 0) return invalidRequest("Requirement does not accept secret setup");
    try {
      const store = getSecretStore() ?? initSecretStore(this.#projectDir);
      for (const ref of refs) {
        const value = secretValues[ref.name];
        if (value === undefined || value.length === 0) {
          return invalidRequest(`Missing value for secret "${ref.name}"`);
        }
        store.set(ref.name, value, ref.scope);
      }
      return { ok: true, status: await this.#freshStatus(found) };
    } catch (err) {
      return storeError(err instanceof Error ? err.message : String(err));
    }
  }

  async start(
    moduleName: string,
    requirementId: string,
  ): Promise<ModuleSetupStartResult> {
    const found = this.#find(moduleName, requirementId);
    if (!found) return notFound(moduleName, requirementId);
    if (found.requirement.setup.mode !== "url") {
      return invalidRequest("Requirement does not expose URL setup");
    }
    try {
      const now = this.#now();
      const ttl = found.requirement.setup.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
      const action: ModuleSetupPendingAction = {
        actionId: `${found.moduleName}.${found.requirement.id}.${now.getTime()}`,
        moduleName: found.moduleName,
        requirementId: found.requirement.id,
        url: found.requirement.setup.url,
        label: found.requirement.setup.label,
        status: "pending",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttl).toISOString(),
      };
      const file = this.#readActions();
      const filtered = file.actions.filter(
        (candidate) =>
          candidate.moduleName !== moduleName ||
          candidate.requirementId !== requirementId ||
          candidate.status !== "pending",
      );
      this.#writeActions({ actions: [...filtered, action] });
      return { ok: true, action, status: await this.#freshStatus(found) };
    } catch (err) {
      return storeError(err instanceof Error ? err.message : String(err));
    }
  }

  async complete(
    actionId: string,
    input: ModuleSetupCompleteInput,
  ): Promise<ModuleSetupMutationResult> {
    const file = this.#readActions();
    const action = file.actions.find((candidate) => candidate.actionId === actionId);
    if (!action) {
      return { ok: false, reason: "not_found", message: `Setup action "${actionId}" not found` };
    }
    const found = this.#find(action.moduleName, action.requirementId);
    if (!found) return notFound(action.moduleName, action.requirementId);
    if (input.configValues) {
      const formResult = await this.submitForm(
        action.moduleName,
        action.requirementId,
        input.configValues,
      );
      if (!formResult.ok) return formResult;
    }
    if (input.secretValues) {
      const secretResult = await this.storeSecret(
        action.moduleName,
        action.requirementId,
        input.secretValues,
      );
      if (!secretResult.ok) return secretResult;
    }
    const completedAt = this.#now().toISOString();
    this.#writeActions({
      actions: file.actions.map((candidate) =>
        candidate.actionId === actionId
          ? { ...candidate, status: "completed", completedAt }
          : candidate,
      ),
    });
    return { ok: true, status: await this.#freshStatus(found) };
  }

  async revoke(
    moduleName: string,
    requirementId: string,
  ): Promise<ModuleSetupMutationResult> {
    const found = this.#find(moduleName, requirementId);
    if (!found) return notFound(moduleName, requirementId);
    try {
      const refs = secretRefsFor(found.requirement);
      if (refs.length > 0) {
        const store = getSecretStore() ?? initSecretStore(this.#projectDir);
        for (const ref of refs) store.remove(ref.name, ref.scope);
      }
      if (found.requirement.kind === "browser-profile") {
        deleteProjectConfigPath(this.#projectDir, found.requirement.storageStateConfigPath);
      }
      const file = this.#readActions();
      const existingActions = file.actions.filter(
        (candidate) =>
          candidate.moduleName === moduleName &&
          candidate.requirementId === requirementId,
      );
      const revokedAt = this.#now().toISOString();
      const syntheticRevocation =
        existingActions.length === 0 && found.requirement.setup.mode === "url"
          ? [{
              actionId: `${found.moduleName}.${found.requirement.id}.revoked.${this.#now().getTime()}`,
              moduleName: found.moduleName,
              requirementId: found.requirement.id,
              url: found.requirement.setup.url,
              label: found.requirement.setup.label,
              status: "revoked" as const,
              createdAt: revokedAt,
              expiresAt: revokedAt,
              completedAt: revokedAt,
            }]
          : [];
      this.#writeActions({
        actions: [
          ...file.actions.map((candidate) =>
            candidate.moduleName === moduleName &&
            candidate.requirementId === requirementId
              ? { ...candidate, status: "revoked" as const, completedAt: revokedAt }
              : candidate,
          ),
          ...syntheticRevocation,
        ],
      });
      return { ok: true, status: await this.#freshStatus(found) };
    } catch (err) {
      return storeError(err instanceof Error ? err.message : String(err));
    }
  }

  #find(
    moduleName: string,
    requirementId: string,
  ): ModuleSetupRequirementContribution | null {
    return this.#getRequirements().find(
      (entry) =>
        entry.moduleName === moduleName &&
        entry.requirement.id === requirementId,
    ) ?? null;
  }

  async #freshStatus(
    found: ModuleSetupRequirementContribution,
  ): Promise<ModuleSetupRequirementStatus> {
    const capabilities = await this.#probeCapabilities();
    return this.#statusFor(found, this.#loadProjectConfig(), capabilities);
  }

  #loadProjectConfig(): KotaConfig {
    return loadConfig(this.#projectDir, { trustedProjects: [this.#projectDir] });
  }

  #statusFor(
    entry: ModuleSetupRequirementContribution,
    config: KotaConfig,
    capabilities: readonly ModuleSetupCapabilityStatus[],
  ): ModuleSetupRequirementStatus {
    const base = baseStatus(entry);
    const pendingAction = this.#latestAction(entry.moduleName, entry.requirement.id);
    const capabilityStatuses = capabilityStatusesFor(entry.requirement, capabilities);

    if (pendingAction && pendingAction.status === "pending") {
      const expires = new Date(pendingAction.expiresAt).getTime();
      if (expires > this.#now().getTime()) {
        return withComputed(base, "pending", "url_setup_pending", "Setup URL action is pending", {
          pendingAction,
          capabilities: capabilityStatuses,
        });
      }
      return withComputed(base, "expired", "url_setup_expired", "Setup URL action expired", {
        pendingAction,
        capabilities: capabilityStatuses,
      });
    }
    if (pendingAction?.status === "revoked") {
      return withComputed(base, "revoked", "credentials_revoked", "Credentials were revoked", {
        pendingAction,
        capabilities: capabilityStatuses,
      });
    }

    switch (entry.requirement.kind) {
      case "config":
        return configStatus(base, entry.requirement, config, capabilityStatuses);
      case "secret":
        return secretStatus(base, entry.requirement, capabilityStatuses, this.#projectDir);
      case "oauth":
        return oauthStatus(base, entry.requirement, capabilityStatuses, this.#projectDir);
      case "browser-profile":
        return browserProfileStatus(base, entry.requirement, config, capabilityStatuses, this.#projectDir);
      case "external-url":
        return externalUrlStatus(base, entry.requirement, config, capabilityStatuses, this.#projectDir);
      case "capability":
        return capabilityStatus(base, capabilityStatuses);
    }
  }

  #actionsPath(): string {
    return join(this.#projectDir, ".kota", "setup-actions.json");
  }

  #readActions(): ModuleSetupActionFile {
    const path = this.#actionsPath();
    if (!existsSync(path)) return { actions: [] };
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ModuleSetupActionFile;
    return { actions: parsed.actions ?? [] };
  }

  #writeActions(file: ModuleSetupActionFile): void {
    const path = this.#actionsPath();
    mkdirSync(join(this.#projectDir, ".kota"), { recursive: true });
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }

  #latestAction(
    moduleName: string,
    requirementId: string,
  ): ModuleSetupPendingAction | undefined {
    return this.#readActions().actions
      .filter((action) => action.moduleName === moduleName && action.requirementId === requirementId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }
}

function baseStatus(
  entry: ModuleSetupRequirementContribution,
): Omit<ModuleSetupRequirementStatus, "state" | "reason" | "message"> {
  const base = {
    moduleName: entry.moduleName,
    requirementId: entry.requirement.id,
    kind: entry.requirement.kind,
    title: entry.requirement.title,
    required: entry.requirement.required,
    scope: entry.requirement.scope,
    sensitivity: entry.requirement.sensitivity,
    setup: entry.requirement.setup,
  };
  return {
    ...base,
    ...(entry.requirement.description !== undefined && { description: entry.requirement.description }),
    ...(entry.requirement.owner !== undefined && { owner: entry.requirement.owner }),
  };
}

function withComputed(
  base: Omit<ModuleSetupRequirementStatus, "state" | "reason" | "message">,
  state: ModuleSetupStatusState,
  reason: string,
  message: string,
  extra: Partial<Pick<
    ModuleSetupRequirementStatus,
    "secretRefs" | "configFields" | "capabilities" | "pendingAction"
  >> = {},
): ModuleSetupRequirementStatus {
  return { ...base, state, reason, message, ...extra };
}

function summarizeStatuses(
  statuses: readonly ModuleSetupRequirementStatus[],
): Record<ModuleSetupStatusState, number> {
  const summary: Record<ModuleSetupStatusState, number> = {
    ready: 0,
    missing: 0,
    pending: 0,
    expired: 0,
    revoked: 0,
    unknown: 0,
    unavailable: 0,
  };
  for (const status of statuses) summary[status.state] += 1;
  return summary;
}

function configStatus(
  base: Omit<ModuleSetupRequirementStatus, "state" | "reason" | "message">,
  req: ModuleSetupConfigRequirement,
  config: KotaConfig,
  capabilities: ModuleSetupCapabilityStatus[],
): ModuleSetupRequirementStatus {
  const fields = req.setup.fields.map((field) => ({
    id: field.id,
    label: field.label,
    configPath: field.configPath,
    required: field.required,
    present: readConfigPath(config, field.configPath) !== undefined,
  }));
  if (fields.some((field) => field.required && !field.present)) {
    return withComputed(base, "missing", "config_missing", "Required configuration is missing", {
      configFields: fields,
      capabilities,
    });
  }
  return withComputed(base, "ready", "config_present", "Required configuration is present", {
    configFields: fields,
    capabilities,
  });
}

function secretStatus(
  base: Omit<ModuleSetupRequirementStatus, "state" | "reason" | "message">,
  req: ModuleSetupSecretRequirement | ModuleSetupOAuthRequirement,
  capabilities: ModuleSetupCapabilityStatus[],
  projectDir: string,
): ModuleSetupRequirementStatus {
  const refs = secretStatuses(req.secretRefs, projectDir);
  if (refs.some((ref) => !ref.present)) {
    return withComputed(base, "missing", "secret_missing", "Required credential is missing", {
      secretRefs: refs,
      capabilities,
    });
  }
  return withComputed(base, "ready", "secret_present", "Required credential reference is present", {
    secretRefs: refs,
    capabilities,
  });
}

function oauthStatus(
  base: Omit<ModuleSetupRequirementStatus, "state" | "reason" | "message">,
  req: ModuleSetupOAuthRequirement,
  capabilities: ModuleSetupCapabilityStatus[],
  projectDir: string,
): ModuleSetupRequirementStatus {
  const refs = secretStatuses(req.secretRefs, projectDir);
  if (refs.some((ref) => !ref.present)) {
    return withComputed(base, "missing", "secret_missing", "Required credential is missing", {
      secretRefs: refs,
      capabilities,
    });
  }
  const failed = capabilities.find((capability) => capability.status !== "ready");
  if (failed) {
    const state =
      failed.reason === "not_reported"
        ? "unknown"
        : failed.status === "init_failed"
          ? "unavailable"
          : "expired";
    return withComputed(
      base,
      state,
      failed.reason ?? "oauth_reauth_required",
      failed.message ?? "OAuth credential needs reauthorization",
      { secretRefs: refs, capabilities },
    );
  }
  return withComputed(base, "ready", "oauth_ready", "OAuth credential is ready", {
    secretRefs: refs,
    capabilities,
  });
}

function browserProfileStatus(
  base: Omit<ModuleSetupRequirementStatus, "state" | "reason" | "message">,
  req: ModuleSetupBrowserProfileRequirement,
  config: KotaConfig,
  capabilities: ModuleSetupCapabilityStatus[],
  projectDir: string,
): ModuleSetupRequirementStatus {
  const configured = readConfigPath(config, req.storageStateConfigPath);
  const fields = req.setup.fields.map((field) => ({
    id: field.id,
    label: field.label,
    configPath: field.configPath,
    required: field.required,
    present: readConfigPath(config, field.configPath) !== undefined,
  }));
  if (typeof configured !== "string" || configured.length === 0) {
    return withComputed(base, "missing", "browser_profile_missing", "Browser profile path is not configured", {
      configFields: fields,
      capabilities,
    });
  }
  const path = isAbsolute(configured) ? configured : resolve(projectDir, configured);
  if (!existsSync(path)) {
    return withComputed(base, "unavailable", "browser_profile_file_missing", "Browser profile file does not exist", {
      configFields: fields,
      capabilities,
    });
  }
  return withComputed(base, "ready", "browser_profile_ready", "Browser profile file is configured", {
    configFields: fields,
    capabilities,
  });
}

function externalUrlStatus(
  base: Omit<ModuleSetupRequirementStatus, "state" | "reason" | "message">,
  req: ModuleSetupExternalUrlRequirement,
  config: KotaConfig,
  capabilities: ModuleSetupCapabilityStatus[],
  projectDir: string,
): ModuleSetupRequirementStatus {
  const refs = req.secretRefs ? secretStatuses(req.secretRefs, projectDir) : [];
  if (refs.some((ref) => !ref.present)) {
    return withComputed(base, "missing", "secret_missing", "Required credential is missing", {
      secretRefs: refs,
      capabilities,
    });
  }
  const missingConfig = (req.completionConfigPaths ?? []).some(
    (path) => readConfigPath(config, path) === undefined,
  );
  if (missingConfig) {
    return withComputed(base, "missing", "external_setup_incomplete", "External setup has not been completed", {
      secretRefs: refs,
      capabilities,
    });
  }
  if (refs.length > 0 || (req.completionConfigPaths ?? []).length > 0) {
    return withComputed(base, "ready", "external_setup_complete", "External setup is complete", {
      secretRefs: refs,
      capabilities,
    });
  }
  return withComputed(base, "unknown", "external_setup_untracked", "External setup has no local completion check", {
    capabilities,
  });
}

function capabilityStatus(
  base: Omit<ModuleSetupRequirementStatus, "state" | "reason" | "message">,
  capabilities: ModuleSetupCapabilityStatus[],
): ModuleSetupRequirementStatus {
  if (capabilities.length === 0) {
    return withComputed(base, "unknown", "capability_status_missing", "Capability status is not reported");
  }
  if (capabilities.every((capability) => capability.status === "ready")) {
    return withComputed(base, "ready", "capability_ready", "Required capability is ready", { capabilities });
  }
  return withComputed(base, "unavailable", "capability_unavailable", "Required capability is unavailable", {
    capabilities,
  });
}

function capabilityStatusesFor(
  req: ModuleSetupRequirement,
  capabilities: readonly ModuleSetupCapabilityStatus[],
): ModuleSetupCapabilityStatus[] {
  const ids = req.kind === "capability" ? req.capabilityIds : req.health?.capabilityIds ?? [];
  return ids.map((id) => capabilities.find((capability) => capability.id === id) ?? {
    id,
    status: "unavailable" as const,
    reason: "not_reported",
    message: "Capability readiness source did not report this id.",
  });
}

function secretRefsFor(req: ModuleSetupRequirement): readonly ModuleSetupSecretRef[] {
  switch (req.kind) {
    case "secret":
    case "oauth":
      return req.secretRefs;
    case "external-url":
      return req.secretRefs ?? [];
    default:
      return [];
  }
}

function secretStatuses(
  refs: readonly ModuleSetupSecretRef[],
  projectDir: string,
): ModuleSetupSecretStatus[] {
  const store = getSecretStore() ?? initSecretStore(projectDir);
  const listed = store.list();
  return refs.map((ref) => {
    const found = listed.find((entry) => entry.name === ref.name);
    return {
      ...ref,
      present: found !== undefined,
      ...(found !== undefined && { source: found.source }),
    };
  });
}

function readConfigPath(
  config: KotaConfig,
  path: string,
): ModuleSetupJsonValue | undefined {
  let current = config as SetupConfigObject;
  const parts = path.split(".");
  for (let index = 0; index < parts.length; index += 1) {
    const value = current[parts[index]!];
    if (value === undefined) return undefined;
    if (index === parts.length - 1) return value;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    current = value as SetupConfigObject;
  }
  return undefined;
}

function setProjectConfigPath(
  projectDir: string,
  path: string,
  value: ModuleSetupFormValue,
): void {
  updateProjectConfig(projectDir, (raw) => {
    const root = raw as SetupConfigObject;
    const parts = path.split(".");
    let current = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index]!;
      const existing = current[part];
      if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
        current[part] = {};
      }
      current = current[part] as SetupConfigObject;
    }
    current[parts[parts.length - 1]!] = value;
    return raw;
  });
}

function deleteProjectConfigPath(projectDir: string, path: string): void {
  updateProjectConfig(projectDir, (raw) => {
    const root = raw as SetupConfigObject;
    const parts = path.split(".");
    let current = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const next = current[parts[index]!];
      if (typeof next !== "object" || next === null || Array.isArray(next)) return raw;
      current = next as SetupConfigObject;
    }
    delete current[parts[parts.length - 1]!];
    return raw;
  });
}

function notFound(moduleName: string, requirementId: string): ModuleSetupFailureResult {
  return {
    ok: false,
    reason: "not_found",
    message: `Setup requirement "${moduleName}/${requirementId}" not found`,
  };
}

function invalidRequest(message: string): ModuleSetupFailureResult {
  return { ok: false, reason: "invalid_request", message };
}

function storeError(message: string): ModuleSetupFailureResult {
  return {
    ok: false,
    reason: "store_error",
    message,
  };
}
