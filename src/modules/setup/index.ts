import type { KotaModule, ModuleContext } from "#core/modules/module-types.js";
import {
  type ModuleSetupJsonValue,
  type ModuleSetupRequirementContribution,
  ModuleSetupService,
  type ModuleSetupStatusResponse,
} from "#core/modules/setup-requirements.js";
import type { DaemonTransport } from "#core/server/daemon-transport.js";
import { buildSetupCommand } from "./cli.js";
import type {
  ModuleSetupMutationResult,
  ModuleSetupStartResult,
  SetupClient,
} from "./client.js";

type JsonObject = { [key: string]: ModuleSetupJsonValue };

function setupRequirementsFromSummaries(
  ctx: ModuleContext,
): ModuleSetupRequirementContribution[] {
  return ctx.getModuleSummaries().flatMap((summary) =>
    (summary.setupRequirements ?? []).map((requirement) => ({
      moduleName: summary.name,
      requirement,
    })),
  );
}

function buildLocalSetupClient(ctx: ModuleContext): SetupClient {
  const service = new ModuleSetupService({
    projectDir: ctx.cwd,
    getRequirements: () => setupRequirementsFromSummaries(ctx),
    probeCapabilities: async () => [],
  });
  return {
    list: () => service.list(),
    submitForm: (moduleName, requirementId, values) =>
      service.submitForm(moduleName, requirementId, values),
    storeSecret: (moduleName, requirementId, secretValues) =>
      service.storeSecret(moduleName, requirementId, secretValues),
    start: (moduleName, requirementId) => service.start(moduleName, requirementId),
    complete: (actionId, input) => service.complete(actionId, input),
    refresh: (moduleName, requirementId) => service.refresh(moduleName, requirementId),
    revoke: (moduleName, requirementId) => service.revoke(moduleName, requirementId),
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
  return {
    list: () =>
      link.requestStrict<ModuleSetupStatusResponse>("GET", "/setup/requirements"),
    submitForm: (moduleName, requirementId, values) =>
      requestSetup<ModuleSetupMutationResult>(
        link,
        "POST",
        `/setup/requirements/${encodeURIComponent(moduleName)}/${encodeURIComponent(requirementId)}/form`,
        { values },
      ),
    storeSecret: (moduleName, requirementId, secretValues) =>
      requestSetup<ModuleSetupMutationResult>(
        link,
        "POST",
        `/setup/requirements/${encodeURIComponent(moduleName)}/${encodeURIComponent(requirementId)}/secret`,
        { secretValues },
      ),
    start: (moduleName, requirementId) =>
      requestSetup<ModuleSetupStartResult>(
        link,
        "POST",
        `/setup/requirements/${encodeURIComponent(moduleName)}/${encodeURIComponent(requirementId)}/start`,
      ),
    complete: (actionId, input) =>
      requestSetup<ModuleSetupMutationResult>(
        link,
        "POST",
        `/setup/actions/${encodeURIComponent(actionId)}/complete`,
        input as JsonObject,
      ),
    refresh: (moduleName, requirementId) =>
      requestSetup<ModuleSetupMutationResult>(
        link,
        "POST",
        `/setup/requirements/${encodeURIComponent(moduleName)}/${encodeURIComponent(requirementId)}/refresh`,
      ),
    revoke: (moduleName, requirementId) =>
      requestSetup<ModuleSetupMutationResult>(
        link,
        "DELETE",
        `/setup/requirements/${encodeURIComponent(moduleName)}/${encodeURIComponent(requirementId)}`,
      ),
  };
}

const setupModule: KotaModule = {
  name: "setup",
  version: "1.0.0",
  description: "Module setup/auth requirement client namespace and CLI",
  commands: (ctx) => [buildSetupCommand(ctx)],
  localClient: (ctx) => ({ setup: buildLocalSetupClient(ctx) }),
  daemonClient: (link) => ({ setup: buildDaemonSetupClient(link) }),
};

export default setupModule;
