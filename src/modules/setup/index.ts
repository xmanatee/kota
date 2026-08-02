import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import { moduleSetupRequirementsFromSummaries } from "#core/modules/module-setup-status.js";
import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import {
  type ModuleSetupJsonValue,
  ModuleSetupService,
  type ModuleSetupStatusResponse,
} from "#core/modules/setup-requirements.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import {
  type ScopeSelector,
  selectedScopeSelectorId,
} from "#core/server/scope-selector.js";
import { buildSetupCommand } from "./cli.js";
import type {
  ModuleSetupMutationResult,
  ModuleSetupStartResult,
  SetupClient,
} from "./client.js";
import { setupUiSurfaceSource } from "./ui-source.js";

type JsonObject = { [key: string]: ModuleSetupJsonValue };

function buildLocalSetupClient(ctx: ModuleContext): SetupClient {
  const services = new Map<string, ModuleSetupService>();
  const serviceFor = (scope?: ScopeSelector): ModuleSetupService => {
    const selectedId = selectedScopeSelectorId(scope);
    let projectDir = ctx.cwd;
    let authorityConfigPath: string | undefined;
    let getVisibility: (() => "hidden" | "metadata" | "full") | undefined;
    if (selectedId !== undefined) {
      const projectScope = ctx.getProvider(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE);
      if (!projectScope) {
        throw new Error(`Unknown scope: ${selectedId}`);
      }
      const resolved = projectScope.resolveProjectRuntime(selectedId);
      if (!resolved.ok) throw new Error(`Unknown scope: ${selectedId}`);
      projectDir = resolved.runtime.project.projectDir;
      authorityConfigPath = resolved.runtime.authorityConfigPath;
      getVisibility = () => resolved.runtime.resolveScopePolicy?.().setup.visibility ?? "full";
    }

    const serviceKey = `${selectedId ?? "local"}\0${projectDir}`;
    let service = services.get(serviceKey);
    if (!service) {
      service = new ModuleSetupService({
        projectDir,
        ...(authorityConfigPath !== undefined ? { authorityConfigPath } : {}),
        getRequirements: () => moduleSetupRequirementsFromSummaries(ctx.getModuleSummaries()),
        probeCapabilities: async () => [],
        getVisibility,
      });
      services.set(serviceKey, service);
    }
    return service;
  };
  return {
    list: (scope) => serviceFor(scope).list(),
    submitForm: (moduleName, requirementId, values, scope) =>
      serviceFor(scope).submitForm(moduleName, requirementId, values),
    storeSecret: (moduleName, requirementId, secretValues, scope) =>
      serviceFor(scope).storeSecret(moduleName, requirementId, secretValues),
    start: (moduleName, requirementId, scope) =>
      serviceFor(scope).start(moduleName, requirementId),
    complete: (actionId, input, scope) => serviceFor(scope).complete(actionId, input),
    refresh: (moduleName, requirementId, scope) =>
      serviceFor(scope).refresh(moduleName, requirementId),
    revoke: (moduleName, requirementId, scope) =>
      serviceFor(scope).revoke(moduleName, requirementId),
  };
}

async function requestSetup<T>(
  link: DaemonTransport,
  method: string,
  path: string,
  body?: JsonObject,
): Promise<T> {
  const res = await link.fetchRaw(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await res.json()) as T;
}

function buildDaemonSetupClient(link: DaemonTransport): SetupClient {
  const unscoped = <T>(scope: ScopeSelector | undefined, operation: () => Promise<T>) => {
    const selectedId = selectedScopeSelectorId(scope);
    if (selectedId !== undefined) {
      return Promise.reject(
        new Error(
          `Scoped setup operation for ${selectedId} must execute through KotaClient.ui.`,
        ),
      );
    }
    return operation();
  };
  return {
    list: (scope) =>
      unscoped(
        scope,
        () => link.requestStrict<ModuleSetupStatusResponse>("GET", "/setup/requirements"),
      ),
    submitForm: (moduleName, requirementId, values, scope) =>
      unscoped(
        scope,
        () => requestSetup<ModuleSetupMutationResult>(
          link,
          "POST",
          `/setup/requirements/${encodeURIComponent(moduleName)}/${encodeURIComponent(requirementId)}/form`,
          { values },
        ),
      ),
    storeSecret: (moduleName, requirementId, secretValues, scope) =>
      unscoped(
        scope,
        () => requestSetup<ModuleSetupMutationResult>(
          link,
          "POST",
          `/setup/requirements/${encodeURIComponent(moduleName)}/${encodeURIComponent(requirementId)}/secret`,
          { secretValues },
        ),
      ),
    start: (moduleName, requirementId, scope) =>
      unscoped(
        scope,
        () => requestSetup<ModuleSetupStartResult>(
          link,
          "POST",
          `/setup/requirements/${encodeURIComponent(moduleName)}/${encodeURIComponent(requirementId)}/start`,
        ),
      ),
    complete: (actionId, input, scope) =>
      unscoped(
        scope,
        () => requestSetup<ModuleSetupMutationResult>(
          link,
          "POST",
          `/setup/actions/${encodeURIComponent(actionId)}/complete`,
          input as JsonObject,
        ),
      ),
    refresh: (moduleName, requirementId, scope) =>
      unscoped(
        scope,
        () => requestSetup<ModuleSetupMutationResult>(
          link,
          "POST",
          `/setup/requirements/${encodeURIComponent(moduleName)}/${encodeURIComponent(requirementId)}/refresh`,
        ),
      ),
    revoke: (moduleName, requirementId, scope) =>
      unscoped(
        scope,
        () => requestSetup<ModuleSetupMutationResult>(
          link,
          "DELETE",
          `/setup/requirements/${encodeURIComponent(moduleName)}/${encodeURIComponent(requirementId)}`,
        ),
      ),
  };
}

const setupModule: KotaModule = {
  name: "setup",
  version: "1.0.0",
  description: "Module setup/auth requirement client namespace and CLI",
  dependencies: ["rendering"],
  uiSurfaces: [setupUiSurfaceSource],
  commands: (ctx) => [buildSetupCommand(ctx)],
  localClient: (ctx) => ({ setup: buildLocalSetupClient(ctx) }),
  daemonClient: (link) => ({ setup: buildDaemonSetupClient(link) }),
};

export default setupModule;
