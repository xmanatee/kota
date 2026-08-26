import { loadConfig } from "#core/config/config.js";
import { getScopeSecretStore } from "#core/config/secrets.js";
import { deleteScopeConfigPath, setScopeConfigPath } from "./config-paths.js";
import { SECRET_REFERENCE_PATTERN } from "./constants.js";
import { ModuleSetupActionStore } from "./pending-actions.js";
import { invalidRequest, notFound, storeError } from "./results.js";
import { validateCompletableSetupAction } from "./service-action-validation.js";
import { projectSetupStatusForVisibility, setupPolicyDenied } from "./service-policy.js";
import { revokedActionFile } from "./service-revoke.js";
import { moduleSetupStatusFor } from "./status.js";
import {
  defaultModuleSetupPendingTtlMs,
  projectModuleSetupActionForAuthorizedStart,
  secretRefsFor,
  summarizeStatuses,
} from "./status-utils.js";
import type {
  ModuleSetupCompleteInput,
  ModuleSetupExecutablePendingAction,
  ModuleSetupFailureResult,
  ModuleSetupFormValues,
  ModuleSetupMutationResult,
  ModuleSetupRequirementContribution,
  ModuleSetupRequirementStatus,
  ModuleSetupServiceOptions,
  ModuleSetupStartResult,
  ModuleSetupStatusResponse,
} from "./types.js";

export class ModuleSetupService {
  readonly #scopeRoot: string;
  readonly #authorityConfigPath: string | undefined;
  readonly #getRequirements: () => readonly ModuleSetupRequirementContribution[];
  readonly #probeCapabilities: ModuleSetupServiceOptions["probeCapabilities"];
  readonly #now: () => Date;
  readonly #actions: ModuleSetupActionStore;
  readonly #getVisibility: NonNullable<ModuleSetupServiceOptions["getVisibility"]>;

  constructor(options: ModuleSetupServiceOptions) {
    this.#scopeRoot = options.scopeRoot;
    this.#authorityConfigPath = options.authorityConfigPath;
    this.#getRequirements = options.getRequirements;
    this.#probeCapabilities = options.probeCapabilities;
    this.#now = options.now ?? (() => new Date());
    this.#getVisibility = options.getVisibility ?? (() => "full");
    this.#actions = new ModuleSetupActionStore(options.scopeRoot);
  }

  async list(): Promise<ModuleSetupStatusResponse> {
    const visibility = this.#getVisibility();
    if (visibility === "hidden") {
      return { visibility, requirements: [], summary: summarizeStatuses([]) };
    }
    const capabilities = await this.#probeCapabilities();
    const config = this.#loadScopeConfig();
    const statuses = this.#getRequirements().map((entry) =>
      this.#projectStatus(
        this.#statusFor(entry, config, capabilities),
      ),
    );
    return { visibility, requirements: statuses, summary: summarizeStatuses(statuses) };
  }

  async refresh(
    moduleName: string,
    requirementId: string,
  ): Promise<ModuleSetupMutationResult> {
    if (this.#getVisibility() === "hidden") return this.#policyDenied();
    const found = this.#find(moduleName, requirementId);
    if (!found) return notFound(moduleName, requirementId);
    return { ok: true, status: await this.#freshStatus(found) };
  }

  async submitForm(
    moduleName: string,
    requirementId: string,
    values: ModuleSetupFormValues,
  ): Promise<ModuleSetupMutationResult> {
    if (this.#getVisibility() !== "full") return this.#policyDenied();
    const found = this.#find(moduleName, requirementId);
    if (!found) return notFound(moduleName, requirementId);
    if (found.requirement.setup.mode !== "form") {
      return invalidRequest("Requirement does not accept form setup");
    }
    const fieldsById = new Map(
      found.requirement.setup.fields.map((field) => [field.id, field] as const),
    );
    for (const id of Object.keys(values)) {
      if (!fieldsById.has(id)) return invalidRequest(`Unknown setup field "${id}"`);
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
      if (
        field.options !== undefined &&
        (typeof value !== "string" || !field.options.some((option) => option.value === value))
      ) {
        return invalidRequest(`Field "${field.id}" must use a declared option`);
      }
      if (field.valueKind === "secret-reference" && (
        typeof value !== "string" ||
        !SECRET_REFERENCE_PATTERN.test(value)
      )) {
        return invalidRequest(
          `Field "${field.id}" must be a secret reference like $GOOGLE_CLIENT_SECRET`,
        );
      }
      setScopeConfigPath(this.#scopeRoot, field.configPath, value);
    }
    return { ok: true, status: await this.#freshStatus(found) };
  }

  async storeSecret(
    moduleName: string,
    requirementId: string,
    secretValues: Record<string, string>,
  ): Promise<ModuleSetupMutationResult> {
    if (this.#getVisibility() !== "full") return this.#policyDenied();
    const found = this.#find(moduleName, requirementId);
    if (!found) return notFound(moduleName, requirementId);
    const refs = secretRefsFor(found.requirement);
    if (refs.length === 0) return invalidRequest("Requirement does not accept secret setup");
    try {
      const store = getScopeSecretStore(this.#scopeRoot);
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
    if (this.#getVisibility() !== "full") return this.#policyDenied();
    const found = this.#find(moduleName, requirementId);
    if (!found) return notFound(moduleName, requirementId);
    if (found.requirement.setup.mode !== "url") {
      return invalidRequest("Requirement does not expose URL setup");
    }
    try {
      const now = this.#now();
      const ttl = found.requirement.setup.pendingTtlMs ??
        defaultModuleSetupPendingTtlMs(found.requirement.scope);
      const action: ModuleSetupExecutablePendingAction = {
        actionId: `${found.moduleName}.${found.requirement.id}.${now.getTime()}`,
        moduleName: found.moduleName,
        requirementId: found.requirement.id,
        url: found.requirement.setup.url,
        label: found.requirement.setup.label,
        status: "pending",
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttl).toISOString(),
      };
      const file = this.#actions.read();
      this.#actions.write({
        actions: [
          ...file.actions.filter(
            (candidate) =>
              candidate.moduleName !== moduleName ||
              candidate.requirementId !== requirementId ||
              candidate.status !== "pending",
          ),
          action,
        ],
      });
      return {
        ok: true,
        action: projectModuleSetupActionForAuthorizedStart(action),
        status: await this.#freshStatus(found),
      };
    } catch (err) {
      return storeError(err instanceof Error ? err.message : String(err));
    }
  }

  async complete(
    actionId: string,
    input: ModuleSetupCompleteInput,
  ): Promise<ModuleSetupMutationResult> {
    if (this.#getVisibility() !== "full") return this.#policyDenied();
    const file = this.#actions.read();
    const action = file.actions.find((candidate) => candidate.actionId === actionId);
    if (!action) {
      return { ok: false, reason: "not_found", message: `Setup action "${actionId}" not found` };
    }
    const found = this.#find(action.moduleName, action.requirementId);
    if (!found) return notFound(action.moduleName, action.requirementId);
    const actionFailure = validateCompletableSetupAction(action, found, this.#now().getTime());
    if (actionFailure) return actionFailure;
    if (input.configValues) {
      const formResult = await this.submitForm(action.moduleName, action.requirementId, input.configValues);
      if (!formResult.ok) return formResult;
    }
    if (input.secretValues) {
      const secretResult = await this.storeSecret(action.moduleName, action.requirementId, input.secretValues);
      if (!secretResult.ok) return secretResult;
    }
    const completedAt = this.#now().toISOString();
    this.#actions.write({
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
    if (this.#getVisibility() !== "full") return this.#policyDenied();
    const found = this.#find(moduleName, requirementId);
    if (!found) return notFound(moduleName, requirementId);
    try {
      const refs = secretRefsFor(found.requirement);
      if (refs.length > 0) {
        const store = getScopeSecretStore(this.#scopeRoot);
        for (const ref of refs) store.remove(ref.name, ref.scope);
      }
      if (found.requirement.kind === "browser-profile") {
        deleteScopeConfigPath(this.#scopeRoot, found.requirement.storageStateConfigPath);
      }
      this.#revokeActions(found, moduleName, requirementId);
      return { ok: true, status: await this.#freshStatus(found) };
    } catch (err) {
      return storeError(err instanceof Error ? err.message : String(err));
    }
  }

  #revokeActions(
    found: ModuleSetupRequirementContribution,
    moduleName: string,
    requirementId: string,
  ): void {
    const file = this.#actions.read();
    const revokedAt = this.#now().toISOString();
    this.#actions.write(
      revokedActionFile({
        file,
        found,
        moduleName,
        requirementId,
        revokedAt,
        actionIdTimeMs: this.#now().getTime(),
      }),
    );
  }

  #find(moduleName: string, requirementId: string): ModuleSetupRequirementContribution | null {
    return this.#getRequirements().find(
      (entry) =>
        entry.moduleName === moduleName &&
        entry.requirement.id === requirementId,
    ) ?? null;
  }

  async #freshStatus(found: ModuleSetupRequirementContribution): Promise<ModuleSetupRequirementStatus> {
    const capabilities = await this.#probeCapabilities();
    return this.#projectStatus(
      this.#statusFor(found, this.#loadScopeConfig(), capabilities),
    );
  }

  #loadScopeConfig(): ReturnType<typeof loadConfig> {
    return loadConfig(
      this.#scopeRoot,
      undefined,
      this.#authorityConfigPath === undefined
        ? undefined
        : { globalConfigPath: this.#authorityConfigPath },
    );
  }

  #projectStatus(status: ModuleSetupRequirementStatus): ModuleSetupRequirementStatus {
    return projectSetupStatusForVisibility(status, this.#getVisibility());
  }

  #policyDenied(): ModuleSetupFailureResult {
    return setupPolicyDenied(this.#getVisibility());
  }

  #statusFor(
    entry: ModuleSetupRequirementContribution,
    config: ReturnType<typeof loadConfig>,
    capabilities: Awaited<ReturnType<ModuleSetupServiceOptions["probeCapabilities"]>>,
  ): ModuleSetupRequirementStatus {
    return moduleSetupStatusFor({
      entry,
      config,
      capabilities,
      pendingAction: this.#actions.latest(entry.moduleName, entry.requirement.id),
      now: this.#now(),
      scopeRoot: this.#scopeRoot,
    });
  }
}
